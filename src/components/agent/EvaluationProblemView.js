import React from "react";
import {
    Box,
    Chip,
    Paper,
    Step,
    StepContent,
    StepLabel,
    Stepper,
    Typography,
} from "@material-ui/core";
import { ThemeContext } from "../../config/config.js";
import { chooseVariables, renderText } from "../../platform-logic/renderText.js";
import { AGENT_META, AGENT_TYPES } from "../../agent/agentTypes.js";
import {
    composeAgentReasoningSummary,
    composeProblemStatement,
    latexToPlainEnglish,
    plainEnglishAnswer,
} from "../../agent/walkthroughText.js";

const LLM_AGENT_TYPES = new Set([
    AGENT_TYPES.LLM,
    AGENT_TYPES.LOCAL_LLM,
    AGENT_TYPES.LOCAL_LLM_PROP,
    AGENT_TYPES.LOCAL_LLM_PROP_CHAIN,
    AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE,
]);

function isLLMAgent(agentType) {
    return LLM_AGENT_TYPES.has(agentType);
}

class EvaluationProblemView extends React.Component {
    static contextType = ThemeContext;

    renderRichText(text, problemId, seed) {
        if (!text) return null;
        const variabilization = chooseVariables({}, seed || problemId);
        return (
            <Typography variant="body2" component="div" style={{ lineHeight: 1.6 }}>
                {renderText(text, problemId, variabilization, this.context)}
            </Typography>
        );
    }

    renderTextBlock(label, text, { monospace = false, maxHeight = 200 } = {}) {
        if (!text) return null;
        return (
            <Box mt={1}>
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    {label}
                </Typography>
                <Paper
                    variant="outlined"
                    style={{
                        padding: 10,
                        maxHeight,
                        overflow: "auto",
                        backgroundColor: "#fff",
                        fontFamily: monospace ? "monospace" : "inherit",
                        fontSize: monospace ? 12 : 14,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                    }}
                >
                    {text}
                </Paper>
            </Box>
        );
    }

    renderPlainEnglishPanel(problem, problemSteps) {
        const statement = composeProblemStatement(problem, problemSteps);
        return (
            <Paper
                variant="outlined"
                style={{
                    padding: 14,
                    marginBottom: 16,
                    backgroundColor: "#e8f4fd",
                    borderLeft: "4px solid #1565c0",
                }}
            >
                <Typography variant="subtitle2" gutterBottom style={{ color: "#0d47a1" }}>
                    Problem in plain English
                </Typography>
                {statement.paragraphs.map((para, i) => (
                    <Typography
                        key={i}
                        variant="body2"
                        paragraph={i < statement.paragraphs.length - 1}
                        style={{ lineHeight: 1.7, fontSize: 14 }}
                    >
                        {para}
                    </Typography>
                ))}
            </Paper>
        );
    }

    renderReasoningSummary(stepTrace, agentType) {
        const lines = composeAgentReasoningSummary(stepTrace, agentType, { AGENT_TYPES });
        if (lines.length === 0) return null;

        return (
            <Box mt={1.5} mb={1}>
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    What the agent did (summary)
                </Typography>
                <Paper
                    variant="outlined"
                    style={{
                        padding: 12,
                        backgroundColor: "#fff",
                        borderLeft: `4px solid ${this.props.agentColor || "#666"}`,
                    }}
                >
                    {lines.map((line, i) => (
                        <Typography
                            key={i}
                            variant="body2"
                            style={{ fontSize: 14, lineHeight: 1.65, marginBottom: i < lines.length - 1 ? 8 : 0 }}
                        >
                            {line}
                        </Typography>
                    ))}
                </Paper>
            </Box>
        );
    }

    renderLLMPanels(stepTrace) {
        const before = stepTrace.llmBefore || stepTrace.llmResponse;
        const after = stepTrace.llmAfter;
        if (!before && !after) return null;

        const beforeCorrect = before?.correct;
        const afterCorrect = after?.correct ?? stepTrace.isCorrect;
        const beforeReasoningPlain = before?.reasoning
            ? latexToPlainEnglish(before.reasoning)
            : "";

        return (
            <Box mt={1.5}>
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    Detailed model response
                </Typography>

                {before && (
                    <Paper
                        variant="outlined"
                        style={{
                            padding: 10,
                            marginBottom: 8,
                            borderLeft: `4px solid ${beforeCorrect ? "#2e7d32" : "#ef6c00"}`,
                            backgroundColor: "#fffde7",
                        }}
                    >
                        <Typography variant="subtitle2" style={{ fontSize: 12 }}>
                            First attempt
                            {beforeCorrect != null && (
                                <Chip
                                    size="small"
                                    label={beforeCorrect ? "✓ correct" : "✗ incorrect"}
                                    style={{
                                        marginLeft: 8,
                                        height: 20,
                                        fontSize: 11,
                                        backgroundColor: beforeCorrect ? "#e8f5e9" : "#ffebee",
                                    }}
                                />
                            )}
                        </Typography>
                        {before.attempt && (
                            <Typography variant="body2" style={{ marginTop: 8, lineHeight: 1.6 }}>
                                <strong>Answer:</strong> {plainEnglishAnswer(before.attempt)}
                            </Typography>
                        )}
                        {beforeReasoningPlain && (
                            <Box mt={1}>
                                <Typography variant="caption" color="textSecondary" display="block">
                                    Reasoning in plain English
                                </Typography>
                                <Typography variant="body2" style={{ marginTop: 4, lineHeight: 1.65 }}>
                                    {beforeReasoningPlain}
                                </Typography>
                            </Box>
                        )}
                        {before.content && latexToPlainEnglish(before.content) !== beforeReasoningPlain && (
                            <Box mt={1}>
                                <Typography variant="caption" color="textSecondary" display="block">
                                    Model explanation
                                </Typography>
                                <Typography variant="body2" style={{ marginTop: 4, lineHeight: 1.65 }}>
                                    {latexToPlainEnglish(before.content)}
                                </Typography>
                            </Box>
                        )}
                        {before.attempt && (
                            <Box mt={1}>
                                <Typography variant="caption" color="textSecondary" display="block">
                                    Answer (formatted math)
                                </Typography>
                                <Typography variant="body2" component="div" style={{ marginTop: 4 }}>
                                    {this.renderRichText(
                                        `$$${String(before.attempt).replace(/^\$\$|\$\$$/g, "")}$$`,
                                        this.props.problem?.id,
                                        this.props.solveTrace?.seed
                                    )}
                                </Typography>
                            </Box>
                        )}
                        {this.renderTextBlock("Technical: raw reasoning", before.reasoning, {
                            monospace: true,
                            maxHeight: 120,
                        })}
                        {this.renderTextBlock("Technical: full raw response", before.rawText, {
                            monospace: true,
                            maxHeight: 120,
                        })}
                        {before.error && (
                            <Typography variant="body2" color="error" style={{ marginTop: 6 }}>
                                Error: {before.error}
                            </Typography>
                        )}
                    </Paper>
                )}

                {after && (
                    <Paper
                        variant="outlined"
                        style={{
                            padding: 10,
                            borderLeft: `4px solid ${afterCorrect ? "#2e7d32" : "#c62828"}`,
                            backgroundColor: "#f5f5f5",
                        }}
                    >
                        <Typography variant="subtitle2" style={{ fontSize: 12 }}>
                            Final submitted answer
                            {afterCorrect != null && (
                                <Chip
                                    size="small"
                                    label={afterCorrect ? "✓ correct" : "✗ incorrect"}
                                    style={{
                                        marginLeft: 8,
                                        height: 20,
                                        fontSize: 11,
                                        backgroundColor: afterCorrect ? "#e8f5e9" : "#ffebee",
                                    }}
                                />
                            )}
                            {after.usedHints && (
                                <Chip
                                    size="small"
                                    label="used hints"
                                    style={{ marginLeft: 8, height: 20, fontSize: 11 }}
                                />
                            )}
                        </Typography>
                        {after.attempt != null && (
                            <>
                                <Typography variant="body2" style={{ marginTop: 8, lineHeight: 1.6 }}>
                                    <strong>Answer:</strong> {plainEnglishAnswer(after.attempt)}
                                </Typography>
                                <Box mt={1}>
                                    <Typography variant="caption" color="textSecondary" display="block">
                                        Answer (formatted math)
                                    </Typography>
                                    <Typography variant="body2" component="div" style={{ marginTop: 4 }}>
                                        {this.renderRichText(
                                            `$$${String(after.attempt).replace(/^\$\$|\$\$$/g, "")}$$`,
                                            this.props.problem?.id,
                                            this.props.solveTrace?.seed
                                        )}
                                    </Typography>
                                </Box>
                            </>
                        )}
                        {after.source && (
                            <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 6 }}>
                                Submitted via: {after.source}
                            </Typography>
                        )}
                    </Paper>
                )}

                {stepTrace.expectedAnswer && (
                    <Box mt={1}>
                        <Typography variant="body2" style={{ lineHeight: 1.6 }}>
                            <strong>Correct answer:</strong>{" "}
                            {plainEnglishAnswer(stepTrace.expectedAnswer)}
                        </Typography>
                        <Typography variant="caption" color="textSecondary" component="div" style={{ marginTop: 4 }}>
                            {this.renderRichText(
                                stepTrace.expectedAnswer.startsWith("$$")
                                    ? stepTrace.expectedAnswer
                                    : `$$${stepTrace.expectedAnswer}$$`,
                                this.props.problem?.id,
                                this.props.solveTrace?.seed
                            )}
                        </Typography>
                    </Box>
                )}
            </Box>
        );
    }

    renderChainPanel(stepTrace) {
        const chain = stepTrace.chainUsed;
        const tried = stepTrace.chainsTried || [];
        if (!chain && tried.length === 0 && !stepTrace.strictNoClues && !stepTrace.chainTreeMeta) {
            return null;
        }

        const treeMeta = stepTrace.chainTreeMeta;

        return (
            <Box mt={1} mb={1}>
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    {treeMeta ? "Beam tree chain" : "Reasoning chain"}
                    {stepTrace.strictNoClues ? " (strict no-clue test)" : ""}
                </Typography>
                {treeMeta && (
                    <Typography variant="caption" color="textSecondary" display="block" style={{ marginBottom: 6 }}>
                        Beam width {treeMeta.beamWidth} · explored {treeMeta.branchesExplored} branch(es) ·{" "}
                        {treeMeta.completeCount} ranked chain(s)
                    </Typography>
                )}
                <Paper variant="outlined" style={{ padding: 8, backgroundColor: "#ede7f6" }}>
                    {chain ? (
                        <>
                            <Typography variant="body2" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 6 }}>
                                Selected chain (score {(chain.score ?? 0).toFixed(2)}, {chain.length || chain.nodes?.length || 0} ideas):
                            </Typography>
                            {(chain.nodes || []).map((n, i) => (
                                <Typography key={i} variant="body2" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 4 }}>
                                    {i + 1}. [{Math.round((n.probMastery || 0) * 100)}%] {latexToPlainEnglish(n.text || "")}
                                </Typography>
                            ))}
                        </>
                    ) : (
                        <Typography variant="body2" style={{ fontSize: 13 }}>
                            No chain reached the conclusion.
                        </Typography>
                    )}
                    {tried.length > 1 && (
                        <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 6 }}>
                            Tried {tried.length} chain(s):{" "}
                            {tried
                                .map((c) => `${c.reachedConclusion ? "✓" : "✗"} ${(c.score ?? 0).toFixed(2)}`)
                                .join(" · ")}
                        </Typography>
                    )}
                </Paper>
            </Box>
        );
    }

    renderPlanPanel(stepTrace) {
        const plan = stepTrace.propPlan;
        if (!plan) return null;

        return (
            <Box mt={1.5}>
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    Hint plan ({plan.planVersion || "hint-plan"})
                    {stepTrace.strictNoClues ? " — strict no-clue" : ""}
                </Typography>
                <Paper variant="outlined" style={{ padding: 8, backgroundColor: "#fff8e1" }}>
                    {plan.pivots?.length > 0 && (
                        <Box mb={1}>
                            <Typography variant="body2" style={{ fontWeight: 600, fontSize: 13 }}>
                                Pivot ideas
                            </Typography>
                            {plan.pivots.map((p, i) => (
                                <Typography key={p.id || i} variant="body2" style={{ fontSize: 13, lineHeight: 1.55 }}>
                                    {i + 1}. [{Math.round((p.probMastery || 0) * 100)}%]{" "}
                                    {latexToPlainEnglish(p.text || "")}
                                </Typography>
                            ))}
                        </Box>
                    )}
                    {plan.relevantHints?.length > 0 && (
                        <Box mb={1}>
                            <Typography variant="body2" style={{ fontWeight: 600, fontSize: 13 }}>
                                Relevant hints
                            </Typography>
                            {plan.relevantHints.map((h, i) => (
                                <Typography key={h.hintId || i} variant="body2" style={{ fontSize: 13, lineHeight: 1.55 }}>
                                    {i + 1}. {latexToPlainEnglish(h.text || "")}
                                </Typography>
                            ))}
                        </Box>
                    )}
                    {plan.candidateChains?.length > 0 && (
                        <Box>
                            <Typography variant="body2" style={{ fontWeight: 600, fontSize: 13 }}>
                                Candidate chains
                            </Typography>
                            {plan.candidateChains.map((c, i) => (
                                <Typography key={c.key || i} variant="body2" style={{ fontSize: 13, lineHeight: 1.55 }}>
                                    {i + 1}. (score {(c.score ?? 0).toFixed(2)}) {c.rootText || c.key}
                                </Typography>
                            ))}
                        </Box>
                    )}
                </Paper>
            </Box>
        );
    }

    renderSuggestedFocus(stepTrace) {
        const focus = stepTrace.propPolicySuggestion;
        if (!focus?.text) return null;
        const pct = Math.round((focus.probMastery || 0) * 100);
        const plainFocus = latexToPlainEnglish(focus.text);
        return (
            <Box mt={1} mb={1}>
                <Typography variant="body2" style={{ fontSize: 13, lineHeight: 1.6 }}>
                    <strong>Suggested focus ({pct}% mastery):</strong> {plainFocus}
                </Typography>
            </Box>
        );
    }

    renderPropBeliefDeltas(stepTrace) {
        const deltas = stepTrace.propBeliefDeltas;
        if (!deltas || Object.keys(deltas).length === 0) return null;

        const entries = Object.values(deltas).sort(
            (a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0)
        );

        return (
            <Box mt={1.5}>
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    Proposition belief updates (Propositional BKT)
                </Typography>
                <Paper variant="outlined" style={{ padding: 8, backgroundColor: "#f3e5f5" }}>
                    {entries.slice(0, 8).map((d, i) => {
                        const pct = Math.round((d.probMastery || 0) * 100);
                        const deltaPct = Math.round((d.delta || 0) * 100);
                        const sign = deltaPct >= 0 ? "+" : "";
                        return (
                            <Typography key={i} variant="body2" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 4 }}>
                                Mastery {pct}% ({sign}{deltaPct}% this step): {latexToPlainEnglish(d.text || "")}
                            </Typography>
                        );
                    })}
                </Paper>
            </Box>
        );
    }

    renderFullProblemStatement(problem, problemSteps, seed) {
        const problemId = problem.id;
        const body = problem.body || "";
        const hasBody = body.trim().length > 0;

        return (
            <Paper
                variant="outlined"
                style={{ padding: 14, marginBottom: 16, backgroundColor: "#fff", borderLeft: "4px solid #1976d2" }}
            >
                <Typography variant="subtitle2" gutterBottom>
                    Problem statement (with math)
                </Typography>
                <Typography variant="body1" style={{ fontWeight: 600, marginBottom: 8 }}>
                    {problem.title || "Untitled problem"}
                </Typography>
                {hasBody ? (
                    this.renderRichText(body, problemId, seed)
                ) : (
                    <Typography variant="body2" color="textSecondary" paragraph>
                        This problem has no separate introduction — read the step questions below.
                    </Typography>
                )}
                {problemSteps.length > 0 && (
                    <Box mt={hasBody ? 2 : 0}>
                        <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                            {hasBody ? "Steps in this problem" : "What you need to solve"}
                        </Typography>
                        {problemSteps.map((step, i) => {
                            const plainQ = latexToPlainEnglish(step.stepTitle || step.stepBody || "");
                            return (
                                <Box key={step.id} mb={1.5} pl={1} style={{ borderLeft: "2px solid #e0e0e0" }}>
                                    <Typography variant="caption" color="textSecondary" display="block">
                                        Step {i + 1}
                                        {step.answerType ? ` · ${step.answerType}` : ""}
                                    </Typography>
                                    {plainQ && (
                                        <Typography variant="body2" style={{ marginTop: 4, lineHeight: 1.6 }}>
                                            {plainQ}
                                        </Typography>
                                    )}
                                    <Box mt={0.5}>{this.renderStepText(step, seed)}</Box>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Paper>
        );
    }

    renderSolveNarrative(stepTrace, agentType) {
        if (!isLLMAgent(agentType)) return null;

        const lines = [];
        const timeline = stepTrace.timeline || [];
        const agentName =
            agentType === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE
                ? "Prop BKT chain tree agent"
                : agentType === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN
                  ? "Prop BKT chain reasoning agent"
                  : agentType === AGENT_TYPES.LOCAL_LLM_PROP
                  ? "Propositional BKT agent"
                  : agentType === AGENT_TYPES.LOCAL_LLM
                    ? "Skill BKT agent (local GPT-OSS)"
                    : "Language-model agent";

        if (timeline.length > 0) {
            lines.push(`${agentName} worked through this step as follows:`);
            timeline.forEach((t, i) => {
                lines.push(`${i + 1}. ${t.label}`);
            });
        } else {
            lines.push(`${agentName} was given the step question and its training beliefs.`);
            const before = stepTrace.llmBefore || stepTrace.llmResponse;
            if (before?.attempt) {
                lines.push(
                    `It first answered "${plainEnglishAnswer(before.attempt)}"${
                        before.correct === true
                            ? ", which was correct."
                            : before.correct === false
                              ? ", which was not correct."
                              : "."
                    }`
                );
            }
            if (stepTrace.llmAfter?.usedHints) {
                lines.push("Because the first answer was wrong, it read the tutoring hints.");
            }
            if (stepTrace.llmAfter?.attempt != null) {
                lines.push(
                    `It then submitted "${plainEnglishAnswer(stepTrace.llmAfter.attempt)}" — ${
                        stepTrace.isCorrect ? "correct" : "incorrect"
                    }.`
                );
            }
        }

        if (lines.length <= 1 && !timeline.length) return null;

        return (
            <Box mt={1.5} mb={1}>
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    Step-by-step narrative
                </Typography>
                <Paper variant="outlined" style={{ padding: 10, backgroundColor: "#fff8e1" }}>
                    {lines.map((line, i) => (
                        <Typography key={i} variant="body2" style={{ fontSize: 14, lineHeight: 1.65, marginBottom: 6 }}>
                            {line}
                        </Typography>
                    ))}
                    {stepTrace.source && (
                        <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 6 }}>
                            Outcome source: {stepTrace.source}
                            {stepTrace.firstTry != null &&
                                ` · ${stepTrace.firstTry ? "first try" : "after hints"}`}
                        </Typography>
                    )}
                </Paper>
            </Box>
        );
    }

    renderStepText(step, seed) {
        const variabilization = chooseVariables(step.variabilization || {}, seed || "eval");
        const problemId = this.props.problem?.id || "";
        const title = step.stepTitle
            ? renderText(step.stepTitle, problemId, variabilization, this.context)
            : null;
        const body = step.stepBody
            ? renderText(step.stepBody, problemId, variabilization, this.context)
            : null;

        return (
            <Box>
                {title && (
                    <Typography variant="subtitle2" component="div" gutterBottom>
                        {title}
                    </Typography>
                )}
                {body && (
                    <Typography variant="body2" component="div" color="textSecondary">
                        {body}
                    </Typography>
                )}
            </Box>
        );
    }

    renderStepTrace(stepTrace, activeStepId, agentType) {
        const isActive = stepTrace.stepId === activeStepId;
        const color = stepTrace.isCorrect ? "#2e7d32" : stepTrace.isCorrect === false ? "#c62828" : "#666";
        const showLLM = isLLMAgent(agentType);

        return (
            <Box
                mt={1}
                p={1.5}
                style={{
                    backgroundColor: isActive ? "#fff8e1" : "#f5f5f5",
                    borderRadius: 4,
                    borderLeft: `3px solid ${this.props.agentColor || "#666"}`,
                }}
            >
                {this.renderReasoningSummary(stepTrace, agentType)}

                {showLLM ? (
                    <>
                        {this.renderSolveNarrative(stepTrace, agentType)}
                        {this.renderLLMPanels(stepTrace)}
                        {!stepTrace.llmBefore && !stepTrace.llmAfter && !stepTrace.llmResponse && (
                            <Typography variant="body2" color="textSecondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
                                No language-model trace was saved for this step. Train the agent on this
                                lesson, then re-run evaluation with a GPT-OSS walkthrough.
                            </Typography>
                        )}
                    </>
                ) : (
                    <>
                        {(stepTrace.timeline || []).length > 0 && (
                            <Box mt={1}>
                                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                                    Detailed action log
                                </Typography>
                                {(stepTrace.timeline || []).map((t, i) => (
                                    <Typography key={`tl-${i}`} variant="body2" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>
                                        • {t.label}
                                    </Typography>
                                ))}
                            </Box>
                        )}

                        {(stepTrace.actions || []).length > 0 && (
                            <Box mt={1}>
                                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                                    Internal actions
                                </Typography>
                                {(stepTrace.actions || []).map((a, i) => (
                                    <Typography key={i} variant="body2" style={{ fontSize: 12, fontFamily: "monospace" }}>
                                        → {a.action}
                                        {a.detail ? `: ${a.detail}` : ""}
                                    </Typography>
                                ))}
                            </Box>
                        )}
                    </>
                )}

                {!showLLM && stepTrace.attempt != null && (
                    <Box mt={1}>
                        <Typography variant="body2" style={{ lineHeight: 1.6, marginBottom: 6 }}>
                            <strong>Answer:</strong> {plainEnglishAnswer(stepTrace.attempt)}
                        </Typography>
                        <Chip
                            size="small"
                            label={`${stepTrace.isCorrect ? "Correct" : "Incorrect"}`}
                            style={{
                                backgroundColor: stepTrace.isCorrect ? "#e8f5e9" : "#ffebee",
                                color,
                                fontWeight: 600,
                            }}
                        />
                        {stepTrace.firstTry != null && (
                            <Chip
                                size="small"
                                label={stepTrace.firstTry ? "First try" : "After hints"}
                                style={{ marginLeft: 8 }}
                            />
                        )}
                    </Box>
                )}

                {!showLLM && stepTrace.expectedAnswer && (
                    <Typography variant="body2" color="textSecondary" display="block" mt={1} style={{ lineHeight: 1.6 }}>
                        Correct answer: <strong>{plainEnglishAnswer(stepTrace.expectedAnswer)}</strong>
                    </Typography>
                )}

                {(stepTrace.bktMode === "proposition" ||
                    stepTrace.bktMode === "proposition-chain" ||
                    stepTrace.bktMode === "proposition-chain-tree" ||
                    agentType === AGENT_TYPES.LOCAL_LLM_PROP ||
                    agentType === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN ||
                    agentType === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE) && (
                    <>
                        {this.renderChainPanel(stepTrace)}
                        {this.renderPlanPanel(stepTrace)}
                        {this.renderSuggestedFocus(stepTrace)}
                        {this.renderPropBeliefDeltas(stepTrace)}
                    </>
                )}
            </Box>
        );
    }

    render() {
        const { problem, solveTrace, agentType, agentLabel, activeStepId, compact } = this.props;
        if (!problem) {
            return (
                <Typography variant="body2" color="textSecondary">
                    No problem selected.
                </Typography>
            );
        }

        const meta = agentType ? AGENT_META[agentType] : null;
        const agentColor = meta?.color;
        const seed = solveTrace?.seed || problem.id;
        const traceSteps = solveTrace?.steps || [];
        const problemSteps = problem.steps || [];
        const statement = composeProblemStatement(problem, problemSteps);
        const headlinePlain =
            statement.stepDescriptions.length === 1
                ? statement.stepDescriptions[0].question
                : statement.title;

        return (
            <Paper variant="outlined" style={{ padding: 16, backgroundColor: "#fafafa" }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                    <Box flex={1}>
                        <Typography variant="overline" color="textSecondary">
                            Problem walkthrough
                        </Typography>
                        <Typography variant="h6" style={{ fontSize: compact ? 16 : 20 }}>
                            {problem.title || "Untitled problem"}
                        </Typography>
                        <Typography variant="body2" color="textSecondary" style={{ marginTop: 4, lineHeight: 1.6 }}>
                            {headlinePlain}
                        </Typography>
                        <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 6 }}>
                            ID: {problem.id} · {problemSteps.length} step(s)
                            {agentLabel ? ` · ${agentLabel}` : ""}
                        </Typography>
                    </Box>
                    <Box display="flex" flexDirection="column" alignItems="flex-end" style={{ gap: 6 }}>
                        {agentLabel && (
                            <Chip
                                label={agentLabel}
                                size="small"
                                style={{ backgroundColor: agentColor, color: "#fff", fontWeight: 600 }}
                            />
                        )}
                        {(solveTrace?.hintRetrievalLabel ||
                            solveTrace?.steps?.[0]?.hintRetrievalLabel) && (
                            <Chip
                                size="small"
                                variant="outlined"
                                label={`Hints: ${
                                    solveTrace?.steps?.find((s) => s.hintRetrievalLabel)
                                        ?.hintRetrievalLabel || solveTrace.hintRetrievalLabel
                                }`}
                            />
                        )}
                    </Box>
                </Box>

                {this.renderPlainEnglishPanel(problem, problemSteps)}
                {this.renderFullProblemStatement(problem, problemSteps, seed)}

                <Typography variant="subtitle2" gutterBottom style={{ marginTop: 8 }}>
                    Step-by-step agent solve
                </Typography>

                <Stepper orientation="vertical" activeStep={-1}>
                    {problemSteps.map((step, index) => {
                        const stepTrace = traceSteps.find((t) => t.stepId === step.id) || {
                            stepId: step.id,
                            stepIndex: index + 1,
                        };
                        const isActive = step.id === activeStepId;

                        return (
                            <Step key={step.id} expanded active={isActive}>
                                <StepLabel
                                    optional={
                                        stepTrace.isCorrect != null ? (
                                            <Typography variant="caption">
                                                {stepTrace.isCorrect ? "✓ Correct" : "✗ Incorrect"}
                                            </Typography>
                                        ) : null
                                    }
                                >
                                    <Typography variant="subtitle2" style={{ lineHeight: 1.5 }}>
                                        {latexToPlainEnglish(step.stepTitle || step.stepBody || "") ||
                                            `Step ${index + 1}`}
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary">
                                        Step {index + 1}
                                        {step.answerType ? ` · ${step.answerType}` : ""}
                                    </Typography>
                                </StepLabel>
                                <StepContent>
                                    {stepTrace.hintRetrievalLabel && (
                                        <Chip
                                            size="small"
                                            variant="outlined"
                                            label={`Hints selected via: ${stepTrace.hintRetrievalLabel}`}
                                            style={{ marginBottom: 8, fontSize: 11 }}
                                        />
                                    )}
                                    <Typography variant="body2" style={{ marginBottom: 8, lineHeight: 1.65 }}>
                                        <strong>Task:</strong>{" "}
                                        {latexToPlainEnglish(step.stepTitle || step.stepBody || "") ||
                                            `Complete step ${index + 1}.`}
                                    </Typography>
                                    {this.renderStepText(step, seed)}
                                    {this.renderStepTrace(stepTrace, activeStepId, agentType)}
                                </StepContent>
                            </Step>
                        );
                    })}
                </Stepper>
            </Paper>
        );
    }
}

export default EvaluationProblemView;
