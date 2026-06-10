import React from "react";
import {
    Box,
    Button,
    Checkbox,
    Chip,
    Divider,
    FormControlLabel,
    LinearProgress,
    Paper,
    Tab,
    Tabs,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from "@material-ui/core";
import AssignmentIcon from "@material-ui/icons/Assignment";
import GetAppIcon from "@material-ui/icons/GetApp";
import { ThemeContext } from "../../config/config.js";
import { filterLessonProblems } from "../../agent/lessonProblems.js";
import { buildSolveTrace } from "../../agent/buildSolveTrace.js";
import {
    AGENT_TYPES,
    AGENT_META,
    ALL_AGENT_TYPES,
    EVALUATION_AGENT_TYPES,
} from "../../agent/agentTypes.js";
import ReasoningDAGView from "./ReasoningDAGView.js";
import EvaluationProblemView from "./EvaluationProblemView.js";
import { latexToPlainEnglish } from "../../agent/walkthroughText.js";
import { downloadLessonEvaluationReportPdf } from "../../agent/testReportPdfExport.js";

function evalAgentTabLabel(type) {
    return AGENT_META[type]?.tableLabel || AGENT_META[type]?.shortLabel || type;
}

function isLocalGptOssEval(agentType) {
    return (
        agentType === AGENT_TYPES.LOCAL_LLM ||
        agentType === AGENT_TYPES.LOCAL_LLM_PROP ||
        agentType === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN ||
        agentType === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE
    );
}

class AgentEvaluationBox extends React.Component {
    static contextType = ThemeContext;

    constructor(props) {
        super(props);
        this.state = {
            selectedProblems: [],
            evaluating: false,
            evaluationReport: null,
            activeAgentTab: AGENT_TYPES.MEMORY,
            activeProblemTab: 0,
            liveEval: null,
        };
    }

    lessonProblems = () => {
        const { lesson, problems } = this.props;
        return filterLessonProblems(problems, lesson, this.context.skillModel);
    };

    findProblem = (problemId) => {
        return this.props.problems?.find((p) => p.id === problemId) || null;
    };

    toggleProblem = (problemId) => {
        this.setState((prev) => {
            const selected = prev.selectedProblems.includes(problemId)
                ? prev.selectedProblems.filter((id) => id !== problemId)
                : [...prev.selectedProblems, problemId];
            return { selectedProblems: selected };
        });
    };

    selectAll = () => {
        const ids = this.lessonProblems().slice(0, 10).map((p) => p.id);
        this.setState({ selectedProblems: ids });
    };

    handleEvalEvent = (event) => {
        this.props.onLog?.(event);
        if (!this.state.evaluating) return;

        this.setState((prev) => {
            const liveEval = { ...(prev.liveEval || { events: [] }) };

            if (event.type === "evaluation-agent-start") {
                liveEval.agentType = event.agentType;
                liveEval.agentLabel = AGENT_META[event.agentType]?.label;
            }

            if (event.type === "eval-start" || event.type === "problem-start") {
                liveEval.problemId = event.problemId;
                liveEval.problem = this.findProblem(event.problemId);
                liveEval.events = [];
                liveEval.activeStepId = null;
            }

            if (event.stepId) {
                if (event.type === "step-start") {
                    liveEval.activeStepId = event.stepId;
                }
            }

            liveEval.events = [...(liveEval.events || []), event].slice(-80);

            if (liveEval.problem) {
                liveEval.partialTrace = buildSolveTrace(
                    liveEval.problem,
                    { events: liveEval.events },
                    null
                );
            }

            return { liveEval };
        });
    };

    downloadEvaluationPdf = () => {
        const { evaluationReport, strictNoClueEval } = this.state;
        const { lesson } = this.props;
        if (!evaluationReport) return;
        try {
            downloadLessonEvaluationReportPdf(evaluationReport, {
                lessonName: lesson?.name,
                lessonId: lesson?.id,
            });
        } catch (err) {
            console.error(err);
        }
    };

    runEvaluation = async (agentTypes = EVALUATION_AGENT_TYPES, { strictNoClues = false } = {}) => {
        const { selectedProblems } = this.state;
        if (selectedProblems.length === 0) return;

        const defaultTab = agentTypes[0] || AGENT_TYPES.MEMORY;

        this.setState({
            evaluating: true,
            evaluationReport: null,
            liveEval: { events: [], agentLabel: "Starting…" },
            activeAgentTab: defaultTab,
            evalAgentTypes: agentTypes,
            strictNoClueEval: strictNoClues,
        });
        this.handleEvalEvent({
            type: "evaluation-start",
            count: selectedProblems.length,
            strictNoClues,
        });

        try {
            const orchestrator = this.props.getOrchestrator();
            const priorOnEvent = orchestrator.onEvent;
            orchestrator.onEvent = (event) => {
                priorOnEvent(event);
                this.handleEvalEvent(event);
            };

            const report = await orchestrator.evaluateOnProblems(selectedProblems, {
                agentTypes,
                strictNoClues,
            });
            orchestrator.onEvent = priorOnEvent;

            this.setState({
                evaluationReport: report,
                evaluating: false,
                activeProblemTab: 0,
                activeAgentTab: defaultTab,
                liveEval: null,
            });
            this.handleEvalEvent({ type: "evaluation-complete", report });
        } catch (err) {
            console.error(err);
            this.setState({ evaluating: false, liveEval: null });
        }
    };

    renderProblemPicker() {
        const problems = this.lessonProblems();
        const { selectedProblems } = this.state;

        return (
            <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="subtitle2">
                        Select problems to evaluate ({problems.length} available)
                    </Typography>
                    <Button size="small" onClick={this.selectAll}>
                        Select first 10
                    </Button>
                </Box>
                <Paper
                    variant="outlined"
                    style={{ maxHeight: 220, overflow: "auto", padding: 8 }}
                >
                    {problems.slice(0, 50).map((p) => (
                        <FormControlLabel
                            key={p.id}
                            control={
                                <Checkbox
                                    size="small"
                                    checked={selectedProblems.includes(p.id)}
                                    onChange={() => this.toggleProblem(p.id)}
                                    color="primary"
                                />
                            }
                            label={
                                <Box>
                                    <Typography variant="body2" style={{ fontSize: 12 }}>
                                        <strong>{p.id}</strong>
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary">
                                        {(p.title || "Untitled").slice(0, 100)}
                                    </Typography>
                                </Box>
                            }
                            style={{ alignItems: "flex-start", marginBottom: 4 }}
                        />
                    ))}
                </Paper>
            </Box>
        );
    }

    renderLiveEvaluation() {
        const { evaluating, liveEval } = this.state;
        if (!evaluating || !liveEval) return null;

        return (
            <Box mt={2}>
                <Typography variant="subtitle1" gutterBottom>
                    Live evaluation
                </Typography>
                <LinearProgress style={{ marginBottom: 12 }} />
                <Typography variant="body2" color="textSecondary" gutterBottom>
                    {liveEval.agentLabel || "Agent"} — {liveEval.problem?.title || liveEval.problemId || "…"}
                </Typography>
                {liveEval.problem && (
                    <EvaluationProblemView
                        problem={liveEval.problem}
                        solveTrace={liveEval.partialTrace}
                        agentType={liveEval.agentType}
                        agentLabel={liveEval.agentLabel}
                        agentColor={AGENT_META[liveEval.agentType]?.color}
                        activeStepId={liveEval.activeStepId}
                        compact={!isLocalGptOssEval(liveEval.agentType)}
                    />
                )}
            </Box>
        );
    }

    renderPerformanceTable(report) {
        return (
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Agent</TableCell>
                        <TableCell>Problem</TableCell>
                        <TableCell align="right">Correct</TableCell>
                        <TableCell align="right">First-Try</TableCell>
                        <TableCell align="right">Steps</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {report.problemResults.map((r, i) => (
                        <TableRow
                            key={i}
                            hover
                            style={{ cursor: "pointer" }}
                            onClick={() => {
                                const agentResults = report.problemResults.filter(
                                    (x) => x.agentType === r.agentType
                                );
                                const pids = [...new Set(agentResults.map((x) => x.problemId))];
                                this.setState({
                                    activeAgentTab: r.agentType,
                                    activeProblemTab: Math.max(0, pids.indexOf(r.problemId)),
                                });
                            }}
                        >
                            <TableCell style={{ color: AGENT_META[r.agentType]?.color }}>
                                {evalAgentTabLabel(r.agentType)}
                            </TableCell>
                            <TableCell>
                                <Typography variant="body2">{r.problemTitle || r.problemId}</Typography>
                                <Typography variant="caption" color="textSecondary">
                                    {r.problemId}
                                </Typography>
                            </TableCell>
                            <TableCell align="right">{r.correct ? "✓" : "✗"}</TableCell>
                            <TableCell align="right">
                                {Math.round((r.firstTryRate || 0) * 100)}%
                            </TableCell>
                            <TableCell align="right">
                                {r.stepsCorrect}/{r.stepsTotal}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        );
    }

    renderReasoningSection(report) {
        const { activeAgentTab, activeProblemTab, evalAgentTypes } = this.state;
        const agentTypes =
            evalAgentTypes ||
            report.agentTypes ||
            [...new Set(report.problemResults.map((r) => r.agentType))];
        const agentResults = report.problemResults.filter((r) => r.agentType === activeAgentTab);
        const problemIds = [...new Set(agentResults.map((r) => r.problemId))];
        const currentProblemId = problemIds[activeProblemTab];
        const currentResult = agentResults.find((r) => r.problemId === currentProblemId);
        const currentProblem = this.findProblem(currentProblemId);
        const cumulative = report.byAgent[activeAgentTab]?.cumulativeReasoning;

        return (
            <Box mt={2}>
                <Typography variant="subtitle1" gutterBottom>
                    Problem walkthrough & reasoning
                </Typography>

                <Tabs
                    value={activeAgentTab}
                    onChange={(_, v) => this.setState({ activeAgentTab: v, activeProblemTab: 0 })}
                    indicatorColor="primary"
                    variant="fullWidth"
                >
                    {agentTypes.map((type) => (
                        <Tab
                            key={type}
                            value={type}
                            label={evalAgentTabLabel(type)}
                            style={{ color: AGENT_META[type].color }}
                        />
                    ))}
                </Tabs>

                <Tabs
                    value={activeProblemTab}
                    onChange={(_, v) => this.setState({ activeProblemTab: v })}
                    variant="scrollable"
                    scrollButtons="auto"
                    style={{ marginTop: 8 }}
                >
                    {problemIds.map((pid, i) => {
                        const pr = agentResults.find((r) => r.problemId === pid);
                        const prob = this.findProblem(pid);
                        const firstStep = prob?.steps?.[0];
                        const plain =
                            latexToPlainEnglish(firstStep?.stepTitle || firstStep?.stepBody || "") ||
                            prob?.title ||
                            pr?.problemTitle ||
                            pid;
                        return (
                            <Tab
                                key={pid}
                                value={i}
                                title={prob?.title || pr?.problemTitle || pid}
                                label={plain.slice(0, 36)}
                            />
                        );
                    })}
                </Tabs>

                <Box mt={2}>
                    <EvaluationProblemView
                        problem={currentProblem}
                        solveTrace={currentResult?.solveTrace}
                        agentType={activeAgentTab}
                        agentLabel={AGENT_META[activeAgentTab]?.label}
                        agentColor={AGENT_META[activeAgentTab]?.color}
                    />
                </Box>

                <Box mt={3}>
                    <Typography variant="subtitle2" gutterBottom>
                        Session reasoning DAG — {currentProblem?.title || currentProblemId}
                    </Typography>
                    <ReasoningDAGView
                        dag={currentResult?.sessionReasoning}
                        agentType={activeAgentTab}
                        variant="session"
                    />
                </Box>

                <Box mt={3}>
                    <Typography variant="subtitle2" gutterBottom>
                        Cumulative reasoning graph (all transitions with P(to|from))
                    </Typography>
                    <ReasoningDAGView
                        dag={cumulative}
                        agentType={activeAgentTab}
                        variant="cumulative"
                        title={`${AGENT_META[activeAgentTab].label} — trained + evaluated`}
                    />
                </Box>
            </Box>
        );
    }

    render() {
        const { evaluating, evaluationReport, selectedProblems } = this.state;

        return (
            <Paper style={{ padding: 20, marginTop: 24, borderTop: "3px solid #ff9800" }}>
                <Box display="flex" alignItems="center" mb={1}>
                    <AssignmentIcon style={{ marginRight: 8, color: "#ff9800" }} />
                    <Typography variant="h6">Problem Evaluation & Reasoning Graphs</Typography>
                </Box>

                <Typography variant="body2" color="textSecondary" paragraph>
                    Select problems and watch each agent solve them step by step — full problem
                    statement, LLM before/after responses for trained GPT-OSS agents, hints used,
                    and reasoning graphs.
                </Typography>

                {this.renderProblemPicker()}

                <Box mt={2} display="flex" alignItems="center" flexWrap="wrap" style={{ gap: 12 }}>
                    <Button
                        variant="contained"
                        style={{ backgroundColor: "#ff9800", color: "#fff" }}
                        onClick={() => this.runEvaluation(EVALUATION_AGENT_TYPES)}
                        disabled={evaluating || selectedProblems.length === 0}
                    >
                        {evaluating
                            ? "Evaluating..."
                            : `Evaluate all agents (${selectedProblems.length} problem${selectedProblems.length === 1 ? "" : "s"})`}
                    </Button>
                    <Button
                        variant="contained"
                        style={{ backgroundColor: "#e65100", color: "#fff" }}
                        onClick={() => this.runEvaluation([AGENT_TYPES.LOCAL_LLM])}
                        disabled={evaluating || selectedProblems.length === 0}
                    >
                        GPT-OSS walkthrough
                    </Button>
                    <Button
                        variant="contained"
                        style={{ backgroundColor: "#6a1b9a", color: "#fff" }}
                        onClick={() => this.runEvaluation([AGENT_TYPES.LOCAL_LLM_PROP])}
                        disabled={evaluating || selectedProblems.length === 0}
                    >
                        Prop BKT walkthrough
                    </Button>
                    <Button
                        variant="contained"
                        style={{ backgroundColor: "#4527a0", color: "#fff" }}
                        onClick={() => this.runEvaluation([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN])}
                        disabled={evaluating || selectedProblems.length === 0}
                    >
                        Prop Chain walkthrough
                    </Button>
                    <Button
                        variant="contained"
                        style={{ backgroundColor: "#283593", color: "#fff" }}
                        onClick={() => this.runEvaluation([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE])}
                        disabled={evaluating || selectedProblems.length === 0}
                    >
                        Prop Tree walkthrough
                    </Button>
                    <Button
                        variant="contained"
                        style={{ backgroundColor: "#1b5e20", color: "#fff" }}
                        onClick={() =>
                            this.runEvaluation(
                                [
                                    AGENT_TYPES.LOCAL_LLM,
                                    AGENT_TYPES.LOCAL_LLM_PROP,
                                    AGENT_TYPES.LOCAL_LLM_PROP_CHAIN,
                                    AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE,
                                ],
                                { strictNoClues: true }
                            )
                        }
                        disabled={evaluating || selectedProblems.length === 0}
                    >
                        Strict no-clue (GPT-OSS agents)
                    </Button>
                    <Button
                        variant="outlined"
                        onClick={() => this.runEvaluation(ALL_AGENT_TYPES)}
                        disabled={evaluating || selectedProblems.length === 0}
                    >
                        Legacy 3 agents only
                    </Button>
                    {selectedProblems.length > 0 && (
                        <Chip size="small" label={`${selectedProblems.length} selected`} />
                    )}
                </Box>
                <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 8 }}>
                    GPT-OSS buttons require prior training on this lesson. Change hint retrieval
                    mode in LLM settings above, then re-run evaluation to compare which strategy
                    scores better. Walkthrough shows retrieval mode per step. Strict no-clue
                    strips hints and disables hint fallback — trained beliefs/chains still apply.
                </Typography>

                {this.renderLiveEvaluation()}

                {evaluationReport && (
                    <Box mt={3}>
                        <Divider />
                        <Box mt={2}>
                            <Typography variant="subtitle1" gutterBottom>
                                Evaluation Results
                            </Typography>
                            <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                                Click a row to jump to that agent&apos;s problem walkthrough.
                            </Typography>
                            {evaluationReport.winner && (
                                <Chip
                                    label={`Best on selected problems: ${evaluationReport.winner.agentLabel}`}
                                    color="primary"
                                    style={{ marginBottom: 12 }}
                                />
                            )}
                            {this.renderPerformanceTable(evaluationReport)}
                            <Box mt={2}>
                                <Button
                                    variant="contained"
                                    color="primary"
                                    size="small"
                                    startIcon={<GetAppIcon />}
                                    onClick={this.downloadEvaluationPdf}
                                >
                                    Download PDF report
                                </Button>
                                {this.state.strictNoClueEval && (
                                    <Chip
                                        size="small"
                                        label="Strict no-clue evaluation"
                                        style={{ marginLeft: 8 }}
                                    />
                                )}
                            </Box>
                        </Box>
                        {this.renderReasoningSection(evaluationReport)}
                    </Box>
                )}
            </Paper>
        );
    }
}

export default AgentEvaluationBox;
