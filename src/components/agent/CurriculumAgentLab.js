import React from "react";
import {
    Box,
    Button,
    Chip,
    Divider,
    Grid,
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
import SchoolIcon from "@material-ui/icons/School";
import PlayArrowIcon from "@material-ui/icons/PlayArrow";
import StopIcon from "@material-ui/icons/Stop";
import GetAppIcon from "@material-ui/icons/GetApp";
import ArrowBackIcon from "@material-ui/icons/ArrowBack";
import { ThemeContext } from "../../config/config.js";
import CrossLessonOrchestrator, {
    loadCurriculumCheckpoint,
    loadCurriculumReport,
} from "../../agent/CrossLessonOrchestrator.js";
import { buildCurriculumSplit } from "../../agent/curriculumSplit.js";
import {
    AGENT_TYPES,
    AGENT_META,
    ALL_AGENT_TYPES,
} from "../../agent/agentTypes.js";
import LLMSettingsPanel from "./LLMSettingsPanel.js";
import {
    buildExportableCurriculumReport,
    buildStorableCurriculumReport,
    copyJsonToClipboard,
    downloadJsonFile,
    loadAndExportCurriculumReport,
    safeJsonStringify,
} from "../../agent/curriculumReportExport.js";
import { AGENT_CURRICULUM_REPORT_STORAGE_KEY } from "../../agent/storageKeys.js";
import EvaluationProblemView from "./EvaluationProblemView.js";

class CurriculumAgentLab extends React.Component {
    static contextType = ThemeContext;

    constructor(props) {
        super(props);
        this.state = {
            running: false,
            phase: null,
            events: [],
            report: null,
            splitPreview: null,
            checkpoint: null,
            reportSavedAt: null,
            copyMessage: null,
            activeAgentTab: AGENT_TYPES.MEMORY,
            activeProblemTab: 0,
            showProblemDetail: false,
            showJsonPreview: false,
            pipelineAgentTypes: ALL_AGENT_TYPES,
        };
    }

    getActiveAgentTypes() {
        return this.state.pipelineAgentTypes || ALL_AGENT_TYPES;
    }

    componentDidMount() {
        this.loadSavedReport();
        this.refreshSplitPreview();
    }

    refreshSplitPreview = () => {
        const { course, lessons, problems } = this.props;
        const split = buildCurriculumSplit(
            problems,
            lessons,
            this.context.skillModel,
            { testRatio: 0.2 }
        );
        this.setState({ splitPreview: split });
    };

    loadSavedReport = async () => {
        const { course, browserStorage } = this.props;
        if (!browserStorage) return;

        const [saved, checkpoint] = await Promise.all([
            loadCurriculumReport(browserStorage, course.courseName),
            loadCurriculumCheckpoint(browserStorage, course.courseName),
        ]);

        if (saved) {
            try {
                const clean = buildStorableCurriculumReport(saved) || saved;
                const savedAgents = Object.keys(clean?.testEvaluation?.summary?.agents || {});
                this.setState({
                    report: clean,
                    reportSavedAt: clean.timestamp,
                    events: [],
                    pipelineAgentTypes:
                        savedAgents.length > 0 ? savedAgents : ALL_AGENT_TYPES,
                    splitPreview: clean.split
                        ? { ...clean.split, stats: clean.split.stats, testProblems: clean.testProblems }
                        : null,
                });
                if (browserStorage && clean !== saved) {
                    browserStorage
                        .setByKey(AGENT_CURRICULUM_REPORT_STORAGE_KEY(course.courseName), clean)
                        .catch(() => {});
                }
            } catch (err) {
                console.error("Failed to load saved curriculum report", err);
            }
        }
        if (checkpoint) {
            this.setState({ checkpoint });
        }
    };

    handleEvent = (event) => {
        const label = this.formatEvent(event);
        this.setState((prev) => ({
            events: [
                ...prev.events.slice(-199),
                { type: event.type, label, timestamp: event.timestamp || Date.now() },
            ],
            phase: this.inferPhase(event),
        }));
    };

    inferPhase(event) {
        if (event.type === "curriculum-test-start") return "testing";
        if (event.type?.includes("train")) return "training";
        if (event.type === "curriculum-complete") return "done";
        return this.state.phase;
    }

    formatEvent(event) {
        switch (event.type) {
            case "curriculum-start":
                return `=== Curriculum pipeline: ${event.split?.trainCount} train / ${event.testCount} test problems ===`;
            case "curriculum-agent-train-start":
                return `--- Training ${AGENT_META[event.agentType]?.label} on all lessons ---`;
            case "curriculum-lesson-train-start":
                return `[${AGENT_META[event.agentType]?.shortLabel}] ${event.lessonTopics}: ${event.problemCount} train problems`;
            case "curriculum-test-start":
                return `=== Test set evaluation (${event.testCount} held-out problems) ===`;
            case "curriculum-test-agent-start":
                return `--- Testing ${AGENT_META[event.agentType]?.label} ---`;
            case "curriculum-complete":
                return `=== Complete. Best on test: ${event.report?.testEvaluation?.winner?.agentLabel || "n/a"} ===`;
            default:
                return event.type;
        }
    }

    createOrchestrator = (agentTypes = ALL_AGENT_TYPES) => {
        const { course, lessons, problems, browserStorage } = this.props;
        return new CrossLessonOrchestrator({
            course,
            lessons,
            problems,
            skillModel: this.context.skillModel,
            bktParams: this.context.bktParams,
            heuristic: this.context.heuristic,
            hintPathway: this.context.hintPathway,
            browserStorage,
            onEvent: this.handleEvent,
            testRatio: 0.2,
            agentTypes,
        });
    };

    runPipeline = async () => {
        this.setState({
            running: true,
            phase: "training",
            events: [],
            report: null,
            pipelineAgentTypes: ALL_AGENT_TYPES,
        });

        this.orchestrator = this.createOrchestrator(ALL_AGENT_TYPES);

        try {
            const report = await this.orchestrator.runFullPipeline();
            const clean = buildStorableCurriculumReport(report) || report;
            this.setState({
                running: false,
                report: clean,
                reportSavedAt: clean.timestamp,
                splitPreview: clean.split,
                phase: "done",
            });
        } catch (err) {
            console.error(err);
            this.setState({ running: false, phase: null });
        }
    };

    stopPipeline = () => {
        if (this.orchestrator) this.orchestrator.cancel();
    };

    runLocalLLMPipeline = async () => {
        const localOnly = [AGENT_TYPES.LOCAL_LLM];
        this.setState({
            running: true,
            phase: "training",
            events: [],
            report: null,
            pipelineAgentTypes: localOnly,
        });

        this.orchestrator = this.createOrchestrator(localOnly);

        try {
            const report = await this.orchestrator.runFullPipeline();
            const clean = buildStorableCurriculumReport(report) || report;
            this.setState({
                running: false,
                report: clean,
                reportSavedAt: clean.timestamp,
                splitPreview: clean.split,
                phase: "done",
            });
        } catch (err) {
            console.error(err);
            this.setState({ running: false, phase: null });
        }
    };

    runLocalLLMTestOnly = async () => {
        const localOnly = [AGENT_TYPES.LOCAL_LLM];
        this.setState({
            running: true,
            phase: "testing",
            events: [],
            pipelineAgentTypes: localOnly,
        });

        this.orchestrator = this.createOrchestrator(localOnly);

        try {
            const report = await this.orchestrator.runTestOnly();
            const clean = buildStorableCurriculumReport(report) || report;
            this.setState({
                running: false,
                report: clean,
                reportSavedAt: clean.timestamp,
                splitPreview: clean.split,
                phase: "done",
            });
        } catch (err) {
            console.error(err);
            this.setState({ running: false, phase: null });
        }
    };

    runTestOnly = async () => {
        this.setState({
            running: true,
            phase: "testing",
            events: [],
            pipelineAgentTypes: ALL_AGENT_TYPES,
        });

        this.orchestrator = this.createOrchestrator(ALL_AGENT_TYPES);

        try {
            const report = await this.orchestrator.runTestOnly();
            const clean = buildStorableCurriculumReport(report) || report;
            this.setState({
                running: false,
                report: clean,
                reportSavedAt: clean.timestamp,
                splitPreview: clean.split,
                phase: "done",
            });
        } catch (err) {
            console.error(err);
            this.setState({ running: false, phase: null });
        }
    };

    getExportJsonText = () => {
        try {
            return safeJsonStringify(this.getExportData());
        } catch (err) {
            return `/* Export error: ${err.message} */`;
        }
    };

    repairSavedReport = async () => {
        const { course, browserStorage } = this.props;
        const clean = buildStorableCurriculumReport(this.state.report);
        if (!clean || !browserStorage) return;
        const key = AGENT_CURRICULUM_REPORT_STORAGE_KEY(course.courseName);
        await browserStorage.setByKey(key, clean).catch(() => {});
        this.setState({ report: clean, copyMessage: "Report repaired and re-saved." });
    };

    getExportData = () => {
        try {
            return buildExportableCurriculumReport(this.state.report);
        } catch (err) {
            console.error("Failed to build export data from state", err);
            return null;
        }
    };

    resolveExportData = async () => {
        const fromState = this.getExportData();
        if (fromState?.testEvaluation) return fromState;

        const { course, browserStorage } = this.props;
        const fromStorage = await loadAndExportCurriculumReport(browserStorage, course.courseName);
        if (fromStorage?.testEvaluation) {
            this.setState({ report: fromStorage, reportSavedAt: fromStorage.timestamp });
            return fromStorage;
        }
        return fromState || fromStorage;
    };

    downloadReport = async () => {
        const { course } = this.props;
        try {
            const data = await this.resolveExportData();
            if (!data?.testEvaluation) {
                this.setState({
                    copyMessage:
                        "No saved report found in memory or browser storage. Run test evaluation first.",
                });
                return;
            }
            const safeName = (course?.courseName || "course").replace(/[^a-z0-9]/gi, "_");
            downloadJsonFile(data, `curriculum-agent-report-${safeName}-${Date.now()}.json`);
            this.setState({ copyMessage: "Download started." });
        } catch (err) {
            console.error(err);
            this.setState({ copyMessage: `Download failed: ${err.message}` });
        }
    };

    copyReport = async () => {
        try {
            const data = await this.resolveExportData();
            if (!data?.testEvaluation) {
                this.setState({ copyMessage: "No report to copy." });
                return;
            }
            await copyJsonToClipboard(data);
            this.setState({ copyMessage: "JSON copied to clipboard." });
        } catch (err) {
            this.setState({ copyMessage: `Copy failed: ${err.message}` });
        }
    };

    renderSplitOverview(split) {
        if (!split?.stats) return null;
        return (
            <Grid container spacing={2}>
                {[
                    ["Lessons", split.stats.lessonCount],
                    ["Train problems", split.stats.trainCount],
                    ["Test problems", split.stats.testCount || split.testProblems?.length],
                    ["Holdout ratio", `${Math.round((split.testRatio || 0.2) * 100)}%`],
                ].map(([label, value]) => (
                    <Grid item xs={6} sm={3} key={label}>
                        <Paper variant="outlined" style={{ padding: 12, textAlign: "center" }}>
                            <Typography variant="caption" color="textSecondary">
                                {label}
                            </Typography>
                            <Typography variant="h6">{value}</Typography>
                        </Paper>
                    </Grid>
                ))}
            </Grid>
        );
    }

    renderTestProblemSet(report) {
        const testProblems = report?.testProblems || [];
        const evaluation = report?.testEvaluation;
        const agentTypes = this.getActiveAgentTypes();

        return (
            <Box mt={3}>
                <Typography variant="h6" gutterBottom>
                    Test set ({testProblems.length} problems)
                </Typography>
                <Typography variant="body2" color="textSecondary" paragraph>
                    Held-out problems share curriculum skills with training lessons but were not
                    used during training.
                </Typography>

                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Problem</TableCell>
                            <TableCell>Lesson</TableCell>
                            {agentTypes.map((t) => (
                                <TableCell key={t} align="center" style={{ color: AGENT_META[t].color }}>
                                    {AGENT_META[t].shortLabel}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {(evaluation?.scoreboard || testProblems).map((row, i) => {
                            const problemId = row.problemId || row.id;
                            const title = row.title || problemId;
                            return (
                                <TableRow
                                    key={problemId}
                                    hover
                                    style={{ cursor: "pointer" }}
                                    onClick={() =>
                                        this.setState({
                                            activeProblemTab: i,
                                            showProblemDetail: true,
                                        })
                                    }
                                >
                                    <TableCell>
                                        <Typography variant="body2" style={{ fontWeight: 500 }}>
                                            {title}
                                        </Typography>
                                        <Typography variant="caption" color="textSecondary">
                                            ID: {problemId}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>{row.lessonTopics || row.lessonName || "—"}</TableCell>
                                    {agentTypes.map((t) => {
                                        const agentResult =
                                            row.agents?.[t] ||
                                            evaluation?.problemResults?.find(
                                                (r) =>
                                                    r.agentType === t && r.problemId === problemId
                                            );
                                        if (!agentResult) {
                                            return (
                                                <TableCell key={t} align="center">
                                                    —
                                                </TableCell>
                                            );
                                        }
                                        return (
                                            <TableCell key={t} align="center">
                                                <Chip
                                                    size="small"
                                                    label={
                                                        agentResult.correct
                                                            ? `✓ ${Math.round((agentResult.firstTryRate || 0) * 100)}% FT`
                                                            : "✗"
                                                    }
                                                    style={{
                                                        backgroundColor: agentResult.correct
                                                            ? "#e8f5e9"
                                                            : "#ffebee",
                                                    }}
                                                />
                                                <Typography variant="caption" display="block">
                                                    {agentResult.stepsCorrect}/{agentResult.stepsTotal}{" "}
                                                    steps
                                                </Typography>
                                            </TableCell>
                                        );
                                    })}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Box>
        );
    }

    renderSummaryScores(report) {
        const summary = report?.testEvaluation?.summary?.agents;
        if (!summary) return null;
        const agentTypes = this.getActiveAgentTypes();

        return (
            <Box mt={2}>
                <Typography variant="subtitle1" gutterBottom>
                    Test set summary scores
                </Typography>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Agent</TableCell>
                            <TableCell align="right">Problems correct</TableCell>
                            <TableCell align="right">Accuracy</TableCell>
                            <TableCell align="right">Avg first-try</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {agentTypes.map((t) => {
                            const s = summary[t];
                            if (!s) return null;
                            return (
                                <TableRow key={t}>
                                    <TableCell style={{ color: AGENT_META[t].color, fontWeight: 600 }}>
                                        {s.label}
                                    </TableCell>
                                    <TableCell align="right">
                                        {s.problemsCorrect}/{s.problemsTotal}
                                    </TableCell>
                                    <TableCell align="right">
                                        {Math.round(s.accuracy * 100)}%
                                    </TableCell>
                                    <TableCell align="right">
                                        {Math.round(s.avgFirstTryRate * 100)}%
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Box>
        );
    }

    renderProblemDetail(report) {
        const { activeAgentTab, activeProblemTab, showProblemDetail } = this.state;
        if (!showProblemDetail || !report?.testEvaluation) return null;

        const agentTypes = this.getActiveAgentTypes();
        const scoreboard = report.testEvaluation.scoreboard || [];
        const row = scoreboard[activeProblemTab];
        if (!row) return null;

        const problem = this.props.problems.find((p) => p.id === row.problemId);
        const agentResult = report.testEvaluation.problemResults?.find(
            (r) => r.agentType === activeAgentTab && r.problemId === row.problemId
        );

        return (
            <Box mt={3}>
                <Typography variant="subtitle1" gutterBottom>
                    Problem walkthrough (test set)
                </Typography>
                <Tabs
                    value={activeAgentTab}
                    onChange={(_, v) => this.setState({ activeAgentTab: v })}
                    variant="fullWidth"
                >
                    {agentTypes.map((t) => (
                        <Tab
                            key={t}
                            value={t}
                            label={AGENT_META[t].shortLabel}
                            style={{ color: AGENT_META[t].color }}
                        />
                    ))}
                </Tabs>
                <Tabs
                    value={activeProblemTab}
                    onChange={(_, v) => this.setState({ activeProblemTab: v })}
                    variant="scrollable"
                    scrollButtons="auto"
                >
                    {scoreboard.map((r, i) => (
                        <Tab
                            key={r.problemId}
                            value={i}
                            label={(r.title || "Untitled problem").slice(0, 36)}
                            title={`${r.title || r.problemId} (${r.problemId})`}
                        />
                    ))}
                </Tabs>
                <Box mt={2}>
                    <EvaluationProblemView
                        problem={problem}
                        solveTrace={agentResult?.solveTrace}
                        agentType={activeAgentTab}
                        agentLabel={AGENT_META[activeAgentTab]?.label}
                    />
                </Box>
            </Box>
        );
    }

    renderTrainBreakdown(split) {
        const trainByLesson = split?.trainByLesson;
        if (!trainByLesson) return null;

        return (
            <Box mt={2}>
                <Typography variant="subtitle2" gutterBottom>
                    Per-lesson train / test split
                </Typography>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Lesson</TableCell>
                            <TableCell align="right">Train</TableCell>
                            <TableCell align="right">Test</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {Object.values(trainByLesson).map((entry) => (
                            <TableRow key={entry.lessonId}>
                                <TableCell>{entry.lessonTopics || entry.lessonName}</TableCell>
                                <TableCell align="right">{entry.train?.length || 0}</TableCell>
                                <TableCell align="right">{entry.test?.length || 0}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Box>
        );
    }

    render() {
        const { course, history, courseNum } = this.props;
        const {
            running,
            phase,
            events,
            report,
            splitPreview,
            checkpoint,
            reportSavedAt,
            copyMessage,
            showJsonPreview,
        } = this.state;
        const split = report?.split || splitPreview;
        const hasSavedAgents = !!checkpoint?.trainingCompletedAt;
        const hasReport = !!report?.testEvaluation || !!reportSavedAt;

        return (
            <Box width="95%" maxWidth={1300} mx="auto" mt={3} role="main">
                <Paper style={{ padding: 24 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                        <Box>
                            <Box display="flex" alignItems="center" mb={1}>
                                <SchoolIcon style={{ marginRight: 8, color: "#1565c0" }} />
                                <Typography variant="h5">Curriculum Train & Test Lab</Typography>
                            </Box>
                            <Typography variant="body2" color="textSecondary">
                                {course.courseName} — train all 3 agents on every lesson, then
                                evaluate on held-out similar problems
                            </Typography>
                        </Box>
                        <Button
                            startIcon={<ArrowBackIcon />}
                            onClick={() => history.push(`/courses/${courseNum}`)}
                        >
                            Back to lessons
                        </Button>
                    </Box>

                    <Typography variant="body2" paragraph>
                        Training uses ~80% of each lesson&apos;s problems. The test set (~20%) covers
                        the same knowledge components but was excluded from training — similar to the
                        curriculum, not identical exposure.
                    </Typography>

                    <LLMSettingsPanel browserStorage={this.props.browserStorage} />

                    {this.renderSplitOverview(split)}
                    {this.renderTrainBreakdown(split)}

                    {(hasSavedAgents || hasReport) && (
                        <Box mt={2} p={1.5} style={{ backgroundColor: "#e8f5e9", borderRadius: 4 }}>
                            <Typography variant="body2">
                                {hasSavedAgents &&
                                    `Training saved ${new Date(checkpoint.trainingCompletedAt).toLocaleString()} — agent states persist in browser storage per lesson.`}
                                {hasReport &&
                                    ` Report saved ${reportSavedAt ? new Date(reportSavedAt).toLocaleString() : ""}.`}
                            </Typography>
                        </Box>
                    )}

                    <Box mt={3} display="flex" style={{ gap: 12, flexWrap: "wrap" }}>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runPipeline}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running && phase === "training"
                                ? "Training on all lessons..."
                                : "Train All Agents & Run Test Set"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#2e7d32", color: "#fff" }}
                            onClick={this.runTestOnly}
                            disabled={running || !split?.stats?.testCount}
                        >
                            {running && phase === "testing"
                                ? "Running test set..."
                                : "Run Test Set Only (use saved agents)"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#e65100", color: "#fff" }}
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runLocalLLMPipeline}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running &&
                            phase === "training" &&
                            this.state.pipelineAgentTypes?.length === 1
                                ? "Training local GPT-OSS..."
                                : "Train Local GPT-OSS & Run Test Set"}
                        </Button>
                        <Button
                            variant="outlined"
                            style={{ borderColor: "#e65100", color: "#e65100" }}
                            onClick={this.runLocalLLMTestOnly}
                            disabled={running || !split?.stats?.testCount}
                        >
                            {running &&
                            phase === "testing" &&
                            this.state.pipelineAgentTypes?.length === 1
                                ? "Testing local GPT-OSS..."
                                : "Local GPT-OSS Test Only"}
                        </Button>
                        <Button
                            variant="outlined"
                            color="secondary"
                            startIcon={<StopIcon />}
                            onClick={this.stopPipeline}
                            disabled={!running}
                        >
                            Stop
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<GetAppIcon />}
                            onClick={this.downloadReport}
                            disabled={!hasReport}
                        >
                            Download JSON report
                        </Button>
                        <Button variant="outlined" onClick={this.copyReport} disabled={!hasReport}>
                            Copy JSON
                        </Button>
                        <Button
                            variant="text"
                            onClick={() => this.setState({ showJsonPreview: !showJsonPreview })}
                            disabled={!hasReport}
                        >
                            {showJsonPreview ? "Hide" : "Show"} JSON preview
                        </Button>
                        <Button
                            variant="outlined"
                            onClick={this.repairSavedReport}
                            disabled={!hasReport}
                        >
                            Repair saved report
                        </Button>
                    </Box>

                    {copyMessage && (
                        <Typography variant="caption" color="textSecondary" display="block" mt={1}>
                            {copyMessage}
                        </Typography>
                    )}

                    {showJsonPreview && hasReport && (
                        <Paper
                            variant="outlined"
                            style={{ marginTop: 12, padding: 12, maxHeight: 360, overflow: "auto" }}
                        >
                            <pre style={{ margin: 0, fontSize: 10 }}>
                                {this.getExportJsonText()}
                            </pre>
                        </Paper>
                    )}

                    {running && (
                        <Box mt={2}>
                            <LinearProgress />
                            <Typography variant="caption" color="textSecondary">
                                Phase: {phase || "starting"} — Memory → RL → LLM on each lesson, then
                                test evaluation
                            </Typography>
                        </Box>
                    )}

                    <Divider style={{ margin: "16px 0" }} />

                    <Typography variant="subtitle2">Pipeline log</Typography>
                    <Paper
                        variant="outlined"
                        style={{
                            padding: 12,
                            maxHeight: 160,
                            overflow: "auto",
                            backgroundColor: "#fafafa",
                            fontFamily: "monospace",
                            fontSize: 11,
                            marginTop: 8,
                        }}
                    >
                        {events.length === 0 && (
                            <Typography variant="body2" color="textSecondary">
                                Run the pipeline to train on all lessons and score the test set.
                            </Typography>
                        )}
                        {events.map((e, i) => (
                            <div key={i}>{e.label}</div>
                        ))}
                    </Paper>

                    {report && (
                        <Box mt={3}>
                            <Divider />
                            {report.testEvaluation?.winner && (
                                <Chip
                                    label={`Best on test set: ${report.testEvaluation.winner.agentLabel}`}
                                    color="primary"
                                    style={{ marginTop: 16, marginBottom: 8 }}
                                />
                            )}
                            {this.renderSummaryScores(report)}
                            {this.renderTestProblemSet(report)}
                            {this.renderProblemDetail(report)}
                        </Box>
                    )}
                </Paper>
            </Box>
        );
    }
}

export default CurriculumAgentLab;
