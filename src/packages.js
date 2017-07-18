import { extractNpmArchiveTo } from './utils';
import { getPackageDependencyTree } from './dependencies';

export default async function fetchPackage({name, reference}) {

    // Check that our reference starts with a valid path prefix.
    if ([`/`, `./`, `../`].some(prefix => reference.startsWith(prefix)))
        return await fs.readFile(reference);

    // If we have a valid reference, fetch.
    if (semver.valid(reference))
        return await fetchPackage({
                name,
                reference: `https://registry.yarnpkg.com/${name}/-/${name}-${reference}.tgz`
            });

    let response = await fetch(reference);

    if (!response.ok)
        throw new Error(`Couldn't fetch package "${reference}"`);

    return await response.buffer();

}







export async function linkPackages({name, reference, dependencies} , cwd) {
    const dependencyTree = await getPackageDependencyTree({
        name,
        reference,
        dependencies
    });

    // The root package will be the only one containing no reference. We can skip its linking.
    if (reference) {
        const packageBuffer = await fetchPackage({
            name,
            reference
        });
        await extractNpmArchiveTo(packageBuffer, cwd);
    }
    // Link all dependencies.
    await Promise.all(dependencies.map(async ({name, reference, dependencies}) => {

        const target = `${cwd}/node_modules/${name}`;
        const binTarget = `${cwd}/node_modules/.bin`;

        await linkPackages({
            name,
            reference,
            dependencies
        }, target);

        const dependencyPackageJson = require(`${target}/package.json`);
        let bin = dependencyPackageJson.bin || {};

        if (typeof bin === `string`)
            bin = {
                [name]: bin
            };
        for (const binName of Object.keys(bin)) {
            const source = resolve(target, bin[binName]);
            const dest = `${binTarget}/${binName}`;
            await fs.mkdirp(`${cwd}/node_modules/.bin`);
            await fs.symlink(relative(binTarget, source), dest);
        }

        // Execute any scripts if they exist.
        if (dependencyPackageJson.scripts) {
            for (let scriptName of [`preinstall`, `install`, `postinstall`]) {

                let script = dependencyPackageJson.scripts[scriptName];

                if (!script)
                    continue;

                await exec(script, {
                    cwd: target,
                    env: Object.assign({}, process.env, {
                        PATH: `${target}/node_modules/.bin:${process.env.PATH}`
                    })
                });

            }
        }
    }));
}


export function optimizePackageTree({name, reference, dependencies}) {

    // This is a Divide & Conquer algorithm - we split the large problem into
    // subproblems that we solve on their own, then we combine their results
    // to find the final solution.
    //
    // In this particular case, we will say that our optimized tree is the result
    // of optimizing a single depth of already-optimized dependencies (ie we first
    // optimize each one of our dependencies independently, then we aggregate their
    // results and optimize them all a last time).
    dependencies = dependencies.map(dependency => {
        return optimizePackageTree(dependency);
    });

    // Now that our dependencies have been optimized, we can start working on
    // doing the second pass to combine their results together. We'll iterate on
    // each one of those "hard" dependencies (called as such because they are
    // strictly required by the package itself rather than one of its dependencies),
    // and check if they contain any sub-dependency that we could "adopt" as our own.
    for (let hardDependency of dependencies.slice()) {
        for (let subDependency of hardDependency.dependencies.slice()) {

            // First we look for a dependency we own that is called
            // just like the sub-dependency we're iterating on.
            let availableDependency = dependencies.find(dependency => {
                return dependency.name === subDependency.name;
            });

            // If there's none, great! It means that there won't be any collision
            // if we decide to adopt this one, so we can just go ahead.
            if (!availableDependency.length)
                dependencies.push(subDependency);

            // If we've adopted the sub-dependency, or if the already existing
            // dependency has the exact same reference than the sub-dependency,
            // then it becames useless and we can simply delete it.
            if (!availableDependency || availableDependency.name === subDependency.name) {
                hardDependency.dependencies.splice(hardDependency.dependencies.findIndex(dependency => {
                    return dependency.name === subDependency.name;
                }));
            }

        }
    }

    return {
        name,
        reference,
        dependencies
    };

}