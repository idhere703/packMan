import fetch from 'node-fetch';
import semver from 'semver';
import fs from 'fs-extra';
import { readPackageJsonFromArchive } from './utils';

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
async function getPackageDependencyTree({name, reference, dependencies}) {
    return {
        name,
        reference,
        // Loop through all dependencies with volatile references.
        dependencies: await Promise.all(dependencies.map(async (volatileDependency) => {
            // Get the pinned dependency.
            const pinnedDependency = await getPinnedReference(volatileDependency);
            // And any sub dependencies.
            const subDependencies = await getPackageDependencies(pinnedDependency);
            // Recursive call! We need all the dependencies of our dependencies.
            return await getPackageDependencyTree(Object.assign({}, pinnedDependency, {
                    dependencies: subDependencies
                }));

        }))
    };

}