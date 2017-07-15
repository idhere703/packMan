import fetch from 'node-fetch';
import semver from 'semver';
import fs from 'fs-extra';
import { readPackageJsonFromArchive, extractNpmArchiveTo } from './utils';

async function fetchPackage({name, reference}) {

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


async function getPinnedReference({name, reference}) {

    // 1.0.0 is a valid range per semver syntax, but since it's also a pinned
    // reference, we don't actually need to process it. Less work, yeay!~
    if (semver.validRange(reference) && !semver.valid(reference)) {

        let response = await fetch(`https://registry.yarnpkg.com/${name}`);
        let info = await response.json();

        let versions = Object.keys(info.versions);
        let maxSatisfying = semver.maxSatisfying(versions, reference);

        if (maxSatisfying === null)
            throw new Error(`Couldn't find a version matching "${reference}" for package "${name}"`);

        reference = maxSatisfying;

    }

    return {
        name,
        reference
    };

}

// Get package dependencies.
async function getPackageDependencies({name, reference}) {
    // Fetch the package.
    const packageBuffer = await fetchPackage({
        name,
        reference
    });
    const packageJson = JSON.parse(await readPackageJsonFromArchive(packageBuffer));
    // Some packages have no dependency field
    const dependencies = packageJson.dependencies || {};

    // Keep using the same {name, reference} data structure for all dependencies.
    return Object.keys(dependencies).map(name => ({
        name,
        reference: dependencies[name]
    }));
}

// Get all dependencies and store them in memory.
async function getPackageDependencyTree({name, reference, dependencies} , available = new Map()) {

    return {
        name,
        reference,
        // Loop through all dependencies.
        dependencies: await Promise.all(dependencies.filter(volatileDependency => {

            const availableReference = available.get(volatileDependency.name);

            // If the volatile reference exactly matches the available reference (for
            // example in the case of two URLs, or two file paths), it means that it
            // is already satisfied by the package provided by its parent. In such a
            // case, we can safely ignore this dependency!
            if (volatileDependency.reference === availableReference)
                return false;

            // If the volatile dependency is a semver range, and if the package
            // provided by its parent satisfies it, we can also safely ignore the
            // dependency.
            if (semver.validRange(volatileDependency.reference)
                && semver.satisfies(availableReference, volatileDependency.reference))
                return false;

            return true;

        }).map(async (volatileDependency) => {
            // Get the pinned dependency.
            const pinnedDependency = await getPinnedReference(volatileDependency);
            // And any sub dependencies.
            const subDependencies = await getPackageDependencies(pinnedDependency);
            let subAvailable = new Map(available);
            subAvailable.set(pinnedDependency.name, pinnedDependency.reference);

            // Recursive call! We need all the dependencies of our dependencies.
            return await getPackageDependencyTree(Object.assign({}, pinnedDependency, {
                    dependencies: subDependencies
                }), subAvailable);

        }))
    };

}


async function linkPackages({name, reference, dependencies} , cwd) {
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