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

const LLM_AGENT_TYPES = new Set([AGENT_TYPES.LLM, AGENT_TYPES.LOCAL_LLM]);

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

    renderLLMPanels(stepTrace) {
        const before = stepTrace.llmBefore || stepTrace.llmResponse;
        const after = stepTrace.llmAfter;
        if (!before && !after) return null;

        const beforeCorrect = before?.correct;
        const afterCorrect = after?.correct ?? stepTrace.isCorrect;

        return (
            <Box mt={1.5}>
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    LLM response (before → after)
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
                            Before (first LLM attempt)
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
                            <Typography variant="body2" style={{ marginTop: 6, fontWeight: 600 }}>
                                Parsed answer: {before.attempt}
                            </Typography>
                        )}
                        {this.renderTextBlock("Model content", before.content, { maxHeight: 120 })}
                        {this.renderTextBlock("Reasoning trace", before.reasoning, {
                            monospace: true,
                            maxHeight: 160,
                        })}
                        {this.renderTextBlock("Full raw response", before.rawText, {
                            monospace: true,
                            maxHeight: 160,
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
                            After (final submitted answer)
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
                            <Typography variant="body2" style={{ marginTop: 6, fontWeight: 600 }}>
                                Final answer: {after.attempt}
                            </Typography>
                        )}
                        {after.source && (
                            <Typography variant="caption" color="textSecondary" display="block">
                                Source: {after.source}
                            </Typography>
                        )}
                    </Paper>
                )}

                {stepTrace.expectedAnswer && (
                    <Box mt={1}>
                        <Typography variant="caption" color="textSecondary">
                            Expected answer:{" "}
                            <strong>{stepTrace.expectedAnswer}</strong>
                        </Typography>
                    </Box>
                )}
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
                {showLLM ? (
                    <>
                        {this.renderLLMPanels(stepTrace)}
                        {!stepTrace.llmBefore && !stepTrace.llmAfter && !stepTrace.llmResponse && (
                            <Typography variant="body2" color="textSecondary" style={{ fontSize: 12 }}>
                                No LLM trace saved for this step (re-run evaluation to capture responses).
                            </Typography>
                        )}
                    </>
                ) : (
                    <>
                        <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                            Agent reasoning
                        </Typography>

                        {(stepTrace.actions || []).map((a, i) => (
                            <Typography
                                key={i}
                                variant="body2"
                                style={{ fontSize: 12, fontFamily: "monospace" }}
                            >
                                → {a.action}
                                {a.detail ? `: ${a.detail}` : ""}
                            </Typography>
                        ))}

                        {(stepTrace.timeline || []).map((t, i) => (
                            <Typography key={`tl-${i}`} variant="body2" style={{ fontSize: 12 }}>
                                • {t.label}
                            </Typography>
                        ))}
                    </>
                )}

                {!showLLM && stepTrace.attempt != null && (
                    <Box mt={1}>
                        <Chip
                            size="small"
                            label={`Answer: ${String(stepTrace.attempt).slice(0, 60)}`}
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
                    <Typography variant="caption" color="textSecondary" display="block" mt={1}>
                        Expected answer: <strong>{stepTrace.expectedAnswer}</strong>
                    </Typography>
                )}

                {showLLM && (stepTrace.actions?.length > 0 || stepTrace.timeline?.length > 0) && (
                    <Box mt={1}>
                        <Typography variant="caption" color="textSecondary" display="block">
                            Action log
                        </Typography>
                        {(stepTrace.timeline || []).map((t, i) => (
                            <Typography key={`tl-${i}`} variant="body2" style={{ fontSize: 11 }}>
                                • {t.label}
                            </Typography>
                        ))}
                    </Box>
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
        const problemBody = problem.body || solveTrace?.problemBody || "";

        return (
            <Paper variant="outlined" style={{ padding: 16, backgroundColor: "#fafafa" }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                    <Box flex={1}>
                        <Typography variant="overline" color="textSecondary">
                            Problem
                        </Typography>
                        <Typography variant="h6" style={{ fontSize: compact ? 16 : 20 }}>
                            {problem.title || "Untitled problem"}
                        </Typography>
                        <Typography variant="caption" color="textSecondary" display="block">
                            ID: {problem.id} · {problemSteps.length} step(s)
                        </Typography>
                    </Box>
                    {agentLabel && (
                        <Chip
                            label={agentLabel}
                            size="small"
                            style={{ backgroundColor: agentColor, color: "#fff", fontWeight: 600 }}
                        />
                    )}
                </Box>

                {problemBody && (
                    <Paper
                        variant="outlined"
                        style={{ padding: 12, marginBottom: 16, backgroundColor: "#fff" }}
                    >
                        <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                            Problem statement
                        </Typography>
                        {this.renderRichText(problemBody, problem.id, seed)}
                    </Paper>
                )}

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
                                    <Typography variant="subtitle2">
                                        Step {index + 1}
                                        {step.answerType ? ` (${step.answerType})` : ""}
                                    </Typography>
                                </StepLabel>
                                <StepContent>
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
