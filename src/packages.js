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