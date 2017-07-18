import { readPackageJsonFromArchive } from './utils';
import { fetchPackage } from './packages';
import { getPinnedReference } from './references';

// Get package dependencies.
export async function getPackageDependencies({name, reference}) {
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
export default async function getPackageDependencyTree({name, reference, dependencies} , available = new Map()) {

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