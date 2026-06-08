import React from "react";
import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    Divider,
    Grid,
    LinearProgress,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
} from "@material-ui/core";
import PlayArrowIcon from "@material-ui/icons/PlayArrow";
import StopIcon from "@material-ui/icons/Stop";
import CompareArrowsIcon from "@material-ui/icons/CompareArrows";
import EmojiEventsIcon from "@material-ui/icons/EmojiEvents";
import TrendingUpIcon from "@material-ui/icons/TrendingUp";
import { ThemeContext } from "../../config/config.js";
import AgentOrchestrator from "../../agent/AgentOrchestrator.js";
import { AGENT_TYPES, AGENT_META, ALL_AGENT_TYPES } from "../../agent/agentTypes.js";
import { normalizeAgentOutput } from "../../agent/agentMetrics.js";
import { buildLessonUrl } from "../../agent/sessionMode.js";
import { SESSION_MODES } from "../../agent/storageKeys.js";
import { filterProblemsForLesson } from "../../agent/problemSelection.js";
import AgentEvaluationBox from "./AgentEvaluationBox.js";
import LLMSettingsPanel from "./LLMSettingsPanel.js";

const METRIC_ROWS = [
    { key: "masteryEnd", label: "Final Mastery", format: (v) => `${Math.round(v * 100)}%`, higher: true },
    { key: "masteryDelta", label: "Mastery Gain (Δ)", format: (v) => `+${Math.round(v * 100)}%`, higher: true },
    { key: "firstTryRate", label: "First-Try Rate", format: (v) => `${Math.round(v * 100)}%`, higher: true },
    { key: "accuracyRate", label: "Overall Accuracy", format: (v) => `${Math.round(v * 100)}%`, higher: true },
    { key: "problemsCompleted", label: "Problems Completed", format: (v) => v, higher: true },
    { key: "hintsConsumed", label: "Hints Used", format: (v) => v, higher: false },
    { key: "durationSec", label: "Duration (sec)", format: (v) => v, higher: false },
    { key: "compositeScore", label: "Composite Score", format: (v) => v.toFixed(3), higher: true },
];

class AgentTrainingPanel extends React.Component {
    static contextType = ThemeContext;

    constructor(props) {
        super(props);
        this.orchestratorRef = null;
        this.logEndRef = React.createRef();

        this.state = {
            running: false,
            runningAgent: null,
            mode: null,
            events: [],
            lastOutput: null,
            comparison: null,
            mastery: props.initialMastery || 0,
        };
    }

    componentDidUpdate(prevProps, prevState) {
        if (this.state.events.length !== prevState.events.length && this.logEndRef.current) {
            this.logEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }

    getOrchestrator = () => {
        const { lesson, displayMastery, saveProgress, problems } = this.props;
        return new AgentOrchestrator({
            lesson,
            problems,
            bktParams: this.context.bktParams,
            heuristic: this.context.heuristic,
            hintPathway: this.context.hintPathway,
            browserStorage: this.context.browserStorage,
            onEvent: this.handleEvent,
            onMasteryUpdate: (m) => {
                this.setState({ mastery: m });
                displayMastery(m);
            },
            stepDelayMs: 200,
        });
    };

    handleEvent = (event) => {
        const label = this.formatEvent(event);
        this.setState((prev) => ({
            events: [...prev.events.slice(-299), { ...event, label }],
        }));
    };

    formatEvent(event) {
        const prefix = event.agentType
            ? `[${AGENT_META[event.agentType]?.shortLabel || event.agentType}] `
            : "";
        switch (event.type) {
            case "comparison-start":
                return "=== Starting 3-agent comparison ===";
            case "comparison-agent-start":
                return `--- Training ${AGENT_META[event.agentType]?.label} ---`;
            case "comparison-agent-end":
                return `--- Finished ${AGENT_META[event.agentType]?.label} ---`;
            case "comparison-complete":
                return `=== Comparison complete. Winner: ${event.comparison?.winner?.agentLabel || "n/a"} ===`;
            case "run-start":
                return `${prefix}Run started (mastery ${Math.round((event.masteryStart || 0) * 100)}%)`;
            case "problem-start":
                return `${prefix}Problem: ${event.title || event.problemId}`;
            case "recall":
                return `${prefix}Recall ${event.stepId} → ${event.isCorrect ? "✓" : "✗"}`;
            case "rl-action":
                return `${prefix}RL action=${event.action} state=${event.state}`;
            case "llm-response":
                return `${prefix}LLM answer for ${event.stepId}`;
            case "llm-error":
                return `${prefix}LLM error: ${event.message || "unknown"}`;
            case "learn":
                return `${prefix}Learned from hints on ${event.stepId}`;
            case "step-complete":
                return `${prefix}Step ${event.stepId}: ${event.isCorrect ? "✓" : "✗"}${event.reward != null ? ` (r=${event.reward})` : ""}`;
            case "graduated":
                return `${prefix}Graduated at ${Math.round((event.mastery || 0) * 100)}%`;
            case "run-complete":
                return `${prefix}Run finished`;
            case "evaluation-start":
                return `=== Evaluating ${event.count || event.problemIds?.length || 0} problem(s) on all agents ===`;
            case "evaluation-agent-start":
                return `--- Evaluating ${AGENT_META[event.agentType]?.label} ---`;
            case "evaluation-agent-end":
                return `--- Finished evaluating ${AGENT_META[event.agentType]?.label} ---`;
            case "evaluation-complete":
                return `=== Evaluation complete. Best: ${event.report?.winner?.agentLabel || "n/a"} ===`;
            case "eval-start":
                return `${prefix}Eval problem: ${event.title || event.problemId}`;
            case "eval-complete":
                return `${prefix}Eval done: ${event.correct ? "✓" : "✗"} (${event.stepsCorrect}/${event.stepsTotal} steps)`;
            default:
                return `${prefix}${event.type}`;
        }
    }

    startSingleAgent = async (agentType) => {
        this.setState({
            running: true,
            runningAgent: agentType,
            mode: "single",
            events: [],
            lastOutput: null,
            comparison: null,
        });

        this.orchestratorRef = this.getOrchestrator();
        try {
            const output = await this.orchestratorRef.runAgent(agentType, { maxProblems: 30 });
            this.props.saveProgress();
            this.setState({ lastOutput: output, running: false, runningAgent: null });
        } catch (err) {
            console.error(err);
            this.handleEvent({ type: "error", message: err.message, agentType });
            this.setState({ running: false, runningAgent: null });
        }
    };

    startComparison = async () => {
        this.setState({
            running: true,
            runningAgent: "all",
            mode: "comparison",
            events: [],
            lastOutput: null,
            comparison: null,
        });

        this.orchestratorRef = this.getOrchestrator();
        try {
            const { comparison, agentOutputs } = await this.orchestratorRef.runComparison({
                maxProblems: 15,
            });
            this.setState({ comparison, agentOutputs, running: false, runningAgent: null });
        } catch (err) {
            console.error(err);
            this.handleEvent({ type: "error", message: err.message });
            this.setState({ running: false, runningAgent: null });
        }
    };

    stopRun = () => {
        if (this.orchestratorRef) this.orchestratorRef.cancel();
    };

    switchToStudentMode = () => {
        const { lesson, history } = this.props;
        history.push(buildLessonUrl(lesson.id, SESSION_MODES.STUDENT));
        window.location.reload();
    };

    renderAgentCards(lessonProblems) {
        const { running, runningAgent } = this.state;
        const hasProblems = (lessonProblems?.length || 0) > 0;

        return (
            <Grid container spacing={2}>
                {ALL_AGENT_TYPES.map((type) => {
                    const meta = AGENT_META[type];
                    const isRunning = running && runningAgent === type;
                    return (
                        <Grid item xs={12} sm={6} md={3} key={type}>
                            <Card
                                variant="outlined"
                                style={{ borderTop: `4px solid ${meta.color}`, height: "100%" }}
                            >
                                <CardContent>
                                    <Typography variant="h6" gutterBottom>
                                        {meta.label}
                                    </Typography>
                                    <Typography variant="body2" color="textSecondary" paragraph>
                                        {meta.description}
                                    </Typography>
                                    <Button
                                        variant="contained"
                                        size="small"
                                        style={{ backgroundColor: meta.color, color: "#fff" }}
                                        startIcon={<PlayArrowIcon />}
                                        onClick={() => this.startSingleAgent(type)}
                                        disabled={running || !hasProblems}
                                    >
                                        {isRunning ? "Training..." : `Train ${meta.shortLabel}`}
                                    </Button>
                                </CardContent>
                            </Card>
                        </Grid>
                    );
                })}
            </Grid>
        );
    }

    renderComparisonTable(comparison) {
        if (!comparison?.agents) return null;

        const agentTypes = ALL_AGENT_TYPES.filter((t) => comparison.agents[t]);
        const winnerType = comparison.winner?.agentType;

        return (
            <Box mt={3}>
                <Typography variant="h6" gutterBottom>
                    <CompareArrowsIcon style={{ verticalAlign: "middle", marginRight: 8 }} />
                    Agent Comparison
                </Typography>

                {comparison.winner && (
                    <Paper
                        style={{
                            padding: 16,
                            marginBottom: 16,
                            backgroundColor: "#e8f5e9",
                            border: "1px solid #a5d6a7",
                        }}
                    >
                        <Box display="flex" alignItems="center" gridGap={8}>
                            <EmojiEventsIcon style={{ color: "#f9a825" }} />
                            <Box>
                                <Typography variant="subtitle1">
                                    Winner: {comparison.winner.agentLabel}
                                </Typography>
                                <Typography variant="body2">{comparison.summary}</Typography>
                            </Box>
                        </Box>
                    </Paper>
                )}

                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Metric</TableCell>
                            {agentTypes.map((type) => (
                                <TableCell
                                    key={type}
                                    align="right"
                                    style={{
                                        fontWeight: winnerType === type ? 700 : 400,
                                        color: AGENT_META[type].color,
                                    }}
                                >
                                    {AGENT_META[type].shortLabel}
                                    {winnerType === type && " ★"}
                                </TableCell>
                            ))}
                            <TableCell align="right">Best</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {METRIC_ROWS.map(({ key, label, format, higher }) => {
                            const values = agentTypes.map((t) => comparison.agents[t][key]);
                            const bestIdx = higher
                                ? values.indexOf(Math.max(...values))
                                : values.indexOf(Math.min(...values));
                            const categoryWinner =
                                comparison.categoryWinners?.[
                                    key === "hintsConsumed" ? "fewestHints" : key
                                ];

                            return (
                                <TableRow key={key}>
                                    <TableCell component="th" scope="row">
                                        {label}
                                    </TableCell>
                                    {agentTypes.map((type, i) => (
                                        <TableCell
                                            key={type}
                                            align="right"
                                            style={{
                                                fontWeight: i === bestIdx ? 700 : 400,
                                                backgroundColor:
                                                    i === bestIdx ? "#f5f5f5" : "transparent",
                                            }}
                                        >
                                            {format(comparison.agents[type][key] ?? 0)}
                                        </TableCell>
                                    ))}
                                    <TableCell align="right">
                                        <Chip
                                            size="small"
                                            label={
                                                categoryWinner?.agentLabel?.split(" ")[0] || "—"
                                            }
                                        />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>

                <Box mt={2}>
                    <Typography variant="subtitle2">Overall Rankings</Typography>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Rank</TableCell>
                                <TableCell>Agent</TableCell>
                                <TableCell align="right">Composite Score</TableCell>
                                <TableCell align="right">Mastery</TableCell>
                                <TableCell align="right">First-Try</TableCell>
                                <TableCell align="right">Problems</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {comparison.rankings.map((r) => (
                                <TableRow
                                    key={r.agentType}
                                    style={{
                                        backgroundColor: r.rank === 1 ? "#fffde7" : "transparent",
                                    }}
                                >
                                    <TableCell>{r.rank}</TableCell>
                                    <TableCell style={{ color: AGENT_META[r.agentType].color }}>
                                        {r.agentLabel}
                                    </TableCell>
                                    <TableCell align="right">{r.compositeScore}</TableCell>
                                    <TableCell align="right">
                                        {Math.round(r.highlights.masteryEnd * 100)}%
                                    </TableCell>
                                    <TableCell align="right">
                                        {Math.round(r.highlights.firstTryRate * 100)}%
                                    </TableCell>
                                    <TableCell align="right">
                                        {r.highlights.problemsCompleted}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>

                <Box mt={2}>
                    <Typography variant="subtitle2">Structured comparison output (JSON)</Typography>
                    <Paper variant="outlined" style={{ padding: 12, maxHeight: 360, overflow: "auto" }}>
                        <pre style={{ margin: 0, fontSize: 11 }}>
                            {JSON.stringify(
                                {
                                    comparisonId: comparison.comparisonId,
                                    timestamp: comparison.timestamp,
                                    lessonId: comparison.lessonId,
                                    winner: comparison.winner,
                                    summary: comparison.summary,
                                    rankings: comparison.rankings,
                                    categoryWinners: comparison.categoryWinners,
                                    agents: comparison.agents,
                                },
                                null,
                                2
                            )}
                        </pre>
                    </Paper>
                </Box>
            </Box>
        );
    }

    renderSingleOutput(output) {
        if (!output) return null;
        const metrics = normalizeAgentOutput(output.agentType, output);
        const meta = AGENT_META[output.agentType];

        return (
            <Box mt={3}>
                <Typography variant="h6" gutterBottom>
                    {meta?.label} — Run Output
                </Typography>
                <Grid container spacing={2}>
                    {[
                        ["Final Mastery", `${Math.round(metrics.masteryEnd * 100)}%`],
                        ["Mastery Gain", `+${Math.round(metrics.masteryDelta * 100)}%`],
                        ["First-Try Rate", `${Math.round(metrics.firstTryRate * 100)}%`],
                        ["Problems", `${metrics.problemsCompleted}/${metrics.problemsAttempted}`],
                    ].map(([label, value]) => (
                        <Grid item xs={6} sm={3} key={label}>
                            <Card variant="outlined">
                                <CardContent>
                                    <Typography color="textSecondary" variant="caption">
                                        {label}
                                    </Typography>
                                    <Typography variant="h6">{value}</Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
                <Box mt={2}>
                    <Paper variant="outlined" style={{ padding: 12, maxHeight: 280, overflow: "auto" }}>
                        <pre style={{ margin: 0, fontSize: 11 }}>
                            {JSON.stringify({ metrics, agentExtras: output.agentExtras }, null, 2)}
                        </pre>
                    </Paper>
                </Box>
            </Box>
        );
    }

    render() {
        const { lesson, problems } = this.props;
        const { running, runningAgent, events, lastOutput, comparison, mastery } = this.state;
        const lessonProblems = filterProblemsForLesson(problems, lesson);

        return (
            <Box width="95%" maxWidth={1300} mx="auto" mt={3} role="main">
                <Paper style={{ padding: 24 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Box>
                            <Typography variant="h5">Multi-Agent Training Lab</Typography>
                            <Typography variant="body2" color="textSecondary">
                                {lesson.name} — {lesson.topics}
                            </Typography>
                            <Typography variant="caption" color="textSecondary" display="block">
                                {lessonProblems.length} problem(s) match this lesson&apos;s skills
                            </Typography>
                        </Box>
                        <Chip label={`BKT Mastery: ${Math.round((mastery || 0) * 100)}%`} color="primary" />
                    </Box>

                    {lessonProblems.length === 0 && (
                        <Box mb={2} p={1.5} style={{ backgroundColor: "#fff3e0", borderRadius: 4 }}>
                            <Typography variant="body2" color="error">
                                No problems in the pool share this lesson&apos;s learning objectives.
                                Training cannot update BKT skills for this lesson until matching
                                content is linked.
                            </Typography>
                        </Box>
                    )}

                    <Typography variant="body2" paragraph>
                        Train and compare three agents on the same lesson curriculum. All agents use
                        the same BKT student model. Comparison runs start each agent from identical
                        BKT state for a fair benchmark.
                    </Typography>

                    <LLMSettingsPanel browserStorage={this.context.browserStorage} />

                    {this.renderAgentCards(lessonProblems)}

                    <Box mt={2}>
                        <Card
                            variant="outlined"
                            style={{ borderTop: "4px solid #e65100" }}
                        >
                            <CardContent>
                                <Typography variant="h6" gutterBottom>
                                    {AGENT_META[AGENT_TYPES.LOCAL_LLM].label}
                                </Typography>
                                <Typography variant="body2" color="textSecondary" paragraph>
                                    {AGENT_META[AGENT_TYPES.LOCAL_LLM].description}
                                </Typography>
                                <Button
                                    variant="contained"
                                    size="medium"
                                    style={{ backgroundColor: "#e65100", color: "#fff" }}
                                    startIcon={<PlayArrowIcon />}
                                    onClick={() => this.startSingleAgent(AGENT_TYPES.LOCAL_LLM)}
                                    disabled={running || lessonProblems.length === 0}
                                >
                                    {running && runningAgent === AGENT_TYPES.LOCAL_LLM
                                        ? "Training local model..."
                                        : "Train Local GPT-OSS Agent"}
                                </Button>
                            </CardContent>
                        </Card>
                    </Box>

                    <Box mt={2} display="flex" style={{ gap: 12, flexWrap: "wrap" }}>
                        <Button
                            variant="contained"
                            color="secondary"
                            startIcon={<CompareArrowsIcon />}
                            onClick={this.startComparison}
                            disabled={running || lessonProblems.length === 0}
                        >
                            {running && runningAgent === "all"
                                ? "Running Comparison..."
                                : "Run All 3 & Compare"}
                        </Button>
                        <Button
                            variant="outlined"
                            color="secondary"
                            startIcon={<StopIcon />}
                            onClick={this.stopRun}
                            disabled={!running}
                        >
                            Stop
                        </Button>
                        <Button variant="text" onClick={this.switchToStudentMode}>
                            Switch to Student Mode
                        </Button>
                    </Box>

                    {running && (
                        <Box mt={2}>
                            <LinearProgress />
                            {runningAgent === "all" && (
                                <Typography variant="caption" color="textSecondary">
                                    Training Memory → RL → LLM agents sequentially with isolated BKT snapshots...
                                </Typography>
                            )}
                        </Box>
                    )}

                    <Divider style={{ margin: "16px 0" }} />

                    <Typography variant="subtitle1" gutterBottom>
                        Live Log
                    </Typography>
                    <Paper
                        variant="outlined"
                        style={{
                            padding: 12,
                            maxHeight: 220,
                            overflow: "auto",
                            backgroundColor: "#fafafa",
                            fontFamily: "monospace",
                            fontSize: 12,
                        }}
                    >
                        {events.length === 0 && (
                            <Typography variant="body2" color="textSecondary">
                                Train an individual agent or run all three to see comparison results.
                            </Typography>
                        )}
                        {events.map((e, i) => (
                            <div key={i}>{e.label}</div>
                        ))}
                        <div ref={this.logEndRef} />
                    </Paper>

                    {comparison && this.renderComparisonTable(comparison)}
                    {!comparison && lastOutput && this.renderSingleOutput(lastOutput)}

                    {typeof this.props.courseNum === "number" && this.props.courseNum >= 0 && (
                        <Box mt={2}>
                            <Button
                                variant="text"
                                color="primary"
                                onClick={() =>
                                    this.props.history.push(
                                        `/courses/${this.props.courseNum}/agent-lab`
                                    )
                                }
                            >
                                Open full curriculum train & test lab →
                            </Button>
                        </Box>
                    )}
                </Paper>

                <AgentEvaluationBox
                    lesson={lesson}
                    problems={problems}
                    getOrchestrator={this.getOrchestrator}
                    onLog={this.handleEvent}
                />
            </Box>
        );
    }
}

export { SESSION_MODES };
export default AgentTrainingPanel;
