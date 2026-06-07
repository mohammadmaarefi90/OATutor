/**
 * Optional KC bridge: aggregate P(know prop) → P(know KC).
 */

export function aggregateNoisyOR(propMasteries) {
    if (!propMasteries.length) return 0;
    let product = 1;
    for (const p of propMasteries) {
        product *= 1 - p;
    }
    return 1 - product;
}

export function aggregateMin(propMasteries) {
    if (!propMasteries.length) return 0;
    return Math.min(...propMasteries);
}

export function computeKCAggregates(beliefStore, structureGraph, strategy = "noisy-or") {
    const kcProps = {};

    for (const node of Object.values(structureGraph.nodes)) {
        for (const skill of node.skills || []) {
            if (!kcProps[skill]) kcProps[skill] = [];
            const belief = beliefStore.getBelief(node.id);
            kcProps[skill].push(belief.probMastery);
        }
    }

    for (const edge of structureGraph.edges) {
        if (edge.type === "skill-link" && edge.to.startsWith("skill:")) {
            const skill = edge.to.slice(6);
            if (!kcProps[skill]) kcProps[skill] = [];
            const belief = beliefStore.getBelief(edge.from);
            kcProps[skill].push(belief.probMastery);
        }
    }

    const aggregateFn = strategy === "min" ? aggregateMin : aggregateNoisyOR;
    const result = {};
    for (const [kc, masteries] of Object.entries(kcProps)) {
        result[kc] = aggregateFn([...new Set(masteries.map((m) => m))]);
    }
    return result;
}
