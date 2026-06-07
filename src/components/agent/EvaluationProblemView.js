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
import { AGENT_META } from "../../agent/agentTypes.js";

class EvaluationProblemView extends React.Component {
    static contextType = ThemeContext;

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

    renderStepTrace(stepTrace, activeStepId) {
        const isActive = stepTrace.stepId === activeStepId;
        const color = stepTrace.isCorrect ? "#2e7d32" : stepTrace.isCorrect === false ? "#c62828" : "#666";

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
                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    Agent reasoning
                </Typography>

                {(stepTrace.actions || []).map((a, i) => (
                    <Typography key={i} variant="body2" style={{ fontSize: 12, fontFamily: "monospace" }}>
                        → {a.action}
                        {a.detail ? `: ${a.detail}` : ""}
                    </Typography>
                ))}

                {(stepTrace.timeline || []).map((t, i) => (
                    <Typography key={`tl-${i}`} variant="body2" style={{ fontSize: 12 }}>
                        • {t.label}
                    </Typography>
                ))}

                {stepTrace.attempt != null && (
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

        return (
            <Paper variant="outlined" style={{ padding: 16, backgroundColor: "#fafafa" }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                    <Box flex={1}>
                        <Typography variant="overline" color="textSecondary">
                            Problem
                        </Typography>
                        <Typography variant="h6" style={{ fontSize: compact ? 16 : 20 }}>
                            {problem.title || problem.id}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                            {problem.id} · {problemSteps.length} step(s)
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
                                    {this.renderStepTrace(stepTrace, activeStepId)}
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
