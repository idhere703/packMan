export default async function getPinnedReference({name, reference}) {

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