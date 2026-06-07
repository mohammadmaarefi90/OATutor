import {
    extractStepPropositions,
    extractHintPropositions,
} from "./propositionExtractor.js";
import { semanticPropositionId } from "./reasoningFlow.js";

/**
 * Proposition graph: nodes are statements; edges encode dependencies and skill links.
 */
export default class PropositionGraph {
    constructor(lessonId, initialData = null) {
        this.lessonId = lessonId;
        this.nodes = initialData?.nodes || {};
        this.edges = initialData?.edges || [];
        this._edgeKeys = new Set(this.edges.map((e) => `${e.from}->${e.to}:${e.type}`));
    }

    static fromJSON(data) {
        if (!data) return null;
        return new PropositionGraph(data.lessonId, data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            nodes: this.nodes,
            edges: this.edges,
            updatedAt: Date.now(),
        };
    }

    snapshot() {
        return {
            nodeCount: Object.keys(this.nodes).length,
            edgeCount: this.edges.length,
            nodes: { ...this.nodes },
            edges: [...this.edges],
        };
    }

    _addEdge(from, to, type, meta = {}) {
        const key = `${from}->${to}:${type}`;
        if (from === to || this._edgeKeys.has(key)) return;
        this._edgeKeys.add(key);
        this.edges.push({ from, to, type, ...meta });
    }

    addProposition(proposition, skills = []) {
        const id = semanticPropositionId(proposition.text);
        if (!this.nodes[id]) {
            this.nodes[id] = {
                id,
                text: proposition.text,
                skills: [...new Set(skills)],
                sources: [],
                visitCount: 0,
                masteryWeight: 0,
            };
        }

        const node = this.nodes[id];
        node.visitCount += 1;
        node.skills = [...new Set([...node.skills, ...skills])];
        node.sources.push({
            sourceType: proposition.sourceType,
            stepId: proposition.stepId,
            problemId: proposition.problemId,
            hintId: proposition.hintId,
            title: proposition.title,
        });

        return id;
    }

    linkPropositions(fromId, toId, type = "depends") {
        if (fromId && toId) {
            this._addEdge(fromId, toId, type);
        }
    }

    linkPropositionToSkill(propositionId, skill) {
        if (propositionId && skill) {
            this._addEdge(propositionId, `skill:${skill}`, "skill");
            if (this.nodes[propositionId]) {
                this.nodes[propositionId].skills = [
                    ...new Set([...this.nodes[propositionId].skills, skill]),
                ];
            }
        }
    }

    ingestStep(step, problemId, skills = []) {
        const stepProps = extractStepPropositions(step, problemId);
        const nodeIds = stepProps.map((p) => this.addProposition(p, skills));

        for (let i = 1; i < nodeIds.length; i++) {
            this.linkPropositions(nodeIds[i - 1], nodeIds[i], "sequence");
        }

        nodeIds.forEach((id) => {
            skills.forEach((skill) => this.linkPropositionToSkill(id, skill));
        });

        return nodeIds;
    }

    ingestHintPathway(hints, step, problemId, skills = [], hintPathwayName = "DefaultPathway") {
        const pathway = hints[hintPathwayName] || hints[Object.keys(hints)[0]] || [];
        const hintNodeMap = {};

        pathway.forEach((hint, hintIndex) => {
            const props = extractHintPropositions(hint, step.id, problemId, hintIndex);
            const propIds = props.map((p) => this.addProposition(p, skills));
            hintNodeMap[hint.id] = propIds;

            propIds.forEach((id) => {
                skills.forEach((skill) => this.linkPropositionToSkill(id, skill));
            });

            (hint.dependencies || []).forEach((depId) => {
                const depPropIds = hintNodeMap[depId];
                if (depPropIds && depPropIds.length > 0 && propIds.length > 0) {
                    this.linkPropositions(
                        depPropIds[depPropIds.length - 1],
                        propIds[0],
                        "depends"
                    );
                }
            });

            if (propIds.length > 1) {
                for (let i = 1; i < propIds.length; i++) {
                    this.linkPropositions(propIds[i - 1], propIds[i], "sequence");
                }
            }
        });

        const stepNodeIds = this.ingestStep(step, problemId, skills);
        const firstHintNodes = pathway.length > 0 ? hintNodeMap[pathway[0].id] : [];
        if (stepNodeIds.length > 0 && firstHintNodes?.length > 0) {
            this.linkPropositions(
                stepNodeIds[stepNodeIds.length - 1],
                firstHintNodes[0],
                "step-to-hint"
            );
        }

        return { pathwayLength: pathway.length, nodesAdded: Object.keys(this.nodes).length };
    }

    getConnectedPropositions(skill) {
        return Object.values(this.nodes).filter((node) => node.skills.includes(skill));
    }

    getStats() {
        const skillLinks = this.edges.filter((e) => e.type === "skill").length;
        return {
            nodeCount: Object.keys(this.nodes).length,
            edgeCount: this.edges.length,
            skillLinks,
            avgVisits:
                Object.values(this.nodes).reduce((sum, n) => sum + n.visitCount, 0) /
                    Math.max(Object.keys(this.nodes).length, 1) || 0,
        };
    }
}
