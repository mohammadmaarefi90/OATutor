import React from "react";
import {
    Box,
    Button,
    Chip,
    Divider,
    FormControl,
    Grid,
    LinearProgress,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Tab,
    Tabs,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@material-ui/core";
import SchoolIcon from "@material-ui/icons/School";
import PlayArrowIcon from "@material-ui/icons/PlayArrow";
import StopIcon from "@material-ui/icons/Stop";
import GetAppIcon from "@material-ui/icons/GetApp";
import ArrowBackIcon from "@material-ui/icons/ArrowBack";
import { ThemeContext } from "../../config/config.js";
import CrossLessonOrchestrator, {
    canResumeCheckpoint,
    CHECKPOINT_STATUS,
    loadCurriculumCheckpoint,
    loadCurriculumReport,
} from "../../agent/CrossLessonOrchestrator.js";
import { buildCurriculumSplit, SPLIT_MODES } from "../../agent/curriculumSplit.js";
import {
    AGENT_TYPES,
    AGENT_META,
    ALL_AGENT_TYPES,
} from "../../agent/agentTypes.js";
import LLMSettingsPanel from "./LLMSettingsPanel.js";
import AgentBackupPanel from "./AgentBackupPanel.js";
import {
    buildExportableCurriculumReport,
    buildStorableCurriculumReport,
    copyJsonToClipboard,
    downloadJsonFile,
    loadAndExportCurriculumReport,
    safeJsonStringify,
} from "../../agent/curriculumReportExport.js";
import { downloadCurriculumTestReportPdf } from "../../agent/testReportPdfExport.js";
import {
    AGENT_CURRICULUM_REPORT_STORAGE_KEY,
    AGENT_CURRICULUM_CHECKPOINT_KEY,
} from "../../agent/storageKeys.js";
import EvaluationProblemView from "./EvaluationProblemView.js";

function agentTableLabel(type) {
    return AGENT_META[type]?.tableLabel || AGENT_META[type]?.shortLabel || type;
}

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
            splitMode: SPLIT_MODES.HOLDOUT_RATIO,
            testPerLesson: 3,
            testRatio: 0.2,
            trainingProgress: null,
            progressLabel: null,
        };
    }

    getActiveAgentTypes() {
        return this.state.pipelineAgentTypes || ALL_AGENT_TYPES;
    }

    componentDidMount() {
        this.loadSavedReport();
        this.refreshSplitPreview();
    }

    getSplitOptions = () => {
        const { splitMode, testPerLesson, testRatio } = this.state;
        return {
            mode: splitMode,
            testRatio: testRatio ?? 0.2,
            testPerLesson: testPerLesson ?? 3,
            seed: "oatutor-curriculum",
        };
    };

    refreshSplitPreview = () => {
        const { lessons, problems } = this.props;
        const split = buildCurriculumSplit(
            problems,
            lessons,
            this.context.skillModel,
            this.getSplitOptions()
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
                    splitMode: clean.split?.mode || this.state.splitMode,
                    testPerLesson: clean.split?.testPerLesson ?? this.state.testPerLesson,
                    testRatio: clean.split?.testRatio ?? this.state.testRatio,
                }, this.refreshSplitPreview);
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
            this.setState(
                {
                    checkpoint,
                    splitMode: checkpoint.split?.mode || SPLIT_MODES.HOLDOUT_RATIO,
                    testPerLesson: checkpoint.split?.testPerLesson ?? 3,
                    testRatio: checkpoint.split?.testRatio ?? 0.2,
                    trainingProgress: checkpoint.progress || null,
                },
                this.refreshSplitPreview
            );
        }
    };

    handleEvent = (event) => {
        const label = this.formatEvent(event);
        const next = {
            events: [
                ...this.state.events.slice(-199),
                { type: event.type, label, timestamp: event.timestamp || Date.now() },
            ],
            phase: this.inferPhase(event),
        };

        if (event.type === "curriculum-progress") {
            next.trainingProgress = event.progress;
            next.progressLabel = event.currentLabel || this.state.progressLabel;
        }
        if (event.type === "curriculum-checkpoint-saved") {
            next.checkpoint = event.checkpoint;
        }
        if (event.type === "curriculum-interrupted" || event.type === "curriculum-training-paused") {
            next.checkpoint = event.checkpoint || this.state.checkpoint;
            next.phase = "paused";
        }

        this.setState(next);
    };

    inferPhase(event) {
        if (event.type === "curriculum-test-start") return "testing";
        if (event.type === "curriculum-interrupted" || event.type === "curriculum-training-paused") {
            return "paused";
        }
        if (event.type?.includes("train")) return "training";
        if (event.type === "curriculum-complete") return "done";
        return this.state.phase;
    }

    formatEvent(event) {
        switch (event.type) {
            case "curriculum-start":
                return `=== Curriculum pipeline (${event.splitMode || "holdout"}): ${event.split?.trainCount} train / ${event.testCount} test problems ===`;
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
            case "curriculum-progress":
                return event.progress
                    ? `Progress: ${event.progress.completedUnits}/${event.progress.totalUnits} lesson jobs (${event.progress.percent}%)`
                    : "Progress updated";
            case "curriculum-interrupted":
                return "=== Training interrupted — checkpoint saved. You can resume or export a backup. ===";
            case "curriculum-training-paused":
                return "=== Training paused before test phase — resume to continue. ===";
            case "curriculum-resume-error":
                return `Resume failed: ${event.message}`;
            default:
                return event.type;
        }
    }

    canResumeTraining = () => {
        const { checkpoint, running } = this.state;
        if (running || !checkpoint) return false;
        const split = this.state.report?.split || this.state.splitPreview;
        return canResumeCheckpoint(checkpoint, { split });
    };

    reloadCheckpoint = async () => {
        const { course, browserStorage } = this.props;
        if (!browserStorage) return;
        const checkpoint = await loadCurriculumCheckpoint(browserStorage, course.courseName);
        if (checkpoint) {
            this.setState({
                checkpoint,
                splitMode: checkpoint.split?.mode || this.state.splitMode,
                testPerLesson: checkpoint.split?.testPerLesson ?? this.state.testPerLesson,
                testRatio: checkpoint.split?.testRatio ?? this.state.testRatio,
                trainingProgress: checkpoint.progress || null,
            });
        }
    };

    clearCheckpoint = async () => {
        const { course, browserStorage } = this.props;
        if (!browserStorage) return;
        await browserStorage.removeByKey(AGENT_CURRICULUM_CHECKPOINT_KEY(course.courseName));
        this.setState({ checkpoint: null, trainingProgress: null, progressLabel: null, phase: null });
    };

    resumeFromCheckpoint = async () => {
        const { checkpoint } = this.state;
        if (!checkpoint?.agentTypes?.length) return;

        const splitOptions = checkpoint.splitOptions || {
            mode: checkpoint.split?.mode,
            testRatio: checkpoint.split?.testRatio,
            testPerLesson: checkpoint.split?.testPerLesson,
            seed: checkpoint.split?.seed,
        };

        await this.runPipelineForAgents(checkpoint.agentTypes, {
            splitOptions,
            resume: true,
        });
    };

    createOrchestrator = (agentTypes = ALL_AGENT_TYPES, splitOptions = null) => {
        const { course, lessons, problems, browserStorage } = this.props;
        const options = splitOptions || this.getSplitOptions();
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
            splitOptions: options,
            agentTypes,
        });
    };

    runPipelineForAgents = async (
        agentTypes,
        { splitOptions = null, testOnly = false, resume = false, strictNoClues = false } = {}
    ) => {
        const options = splitOptions || this.getSplitOptions();
        if (splitOptions) {
            this.setState({
                splitMode: options.mode,
                testPerLesson: options.testPerLesson ?? this.state.testPerLesson,
                testRatio: options.testRatio ?? this.state.testRatio,
            });
        }

        this.setState({
            running: true,
            phase: testOnly ? "testing" : resume ? "training" : "training",
            events: resume ? this.state.events : [],
            report: testOnly ? this.state.report : resume ? this.state.report : null,
            pipelineAgentTypes: agentTypes,
            trainingProgress: resume ? this.state.checkpoint?.progress : null,
            progressLabel: resume
                ? "Resuming…"
                : testOnly && strictNoClues
                  ? "Strict no-clue test…"
                  : null,
            strictNoClueTest: strictNoClues,
        });

        this.orchestrator = this.createOrchestrator(agentTypes, options);

        try {
            let report;
            if (testOnly) {
                report = await this.orchestrator.runTestOnly({ strictNoClues });
            } else if (resume) {
                report = await this.orchestrator.resumeTraining();
            } else {
                report = await this.orchestrator.runFullPipeline();
            }

            const clean = buildStorableCurriculumReport(report) || report;
            await this.reloadCheckpoint();

            const interrupted = Boolean(clean.interrupted);
            this.setState({
                running: false,
                report: clean.testEvaluation || clean.trainingLog ? clean : this.state.report,
                reportSavedAt: clean.timestamp || this.state.reportSavedAt,
                splitPreview: clean.split || this.state.splitPreview,
                phase: interrupted ? "paused" : "done",
                trainingProgress: interrupted
                    ? clean.checkpoint?.progress || this.state.trainingProgress
                    : null,
                progressLabel: null,
            });
        } catch (err) {
            console.error(err);
            await this.reloadCheckpoint();
            this.setState({ running: false, phase: "paused", progressLabel: null });
        }
    };

    runPipeline = async () => {
        await this.runPipelineForAgents(ALL_AGENT_TYPES);
    };

    stopPipeline = async () => {
        if (this.orchestrator) {
            this.orchestrator.cancel();
            await new Promise((resolve) => setTimeout(resolve, 400));
            await this.reloadCheckpoint();
        }
    };

    runLocalLLMPipeline = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM]);
    };

    runLocalLLMTestOnly = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM], { testOnly: true });
    };

    runPropBKTPipeline = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP]);
    };

    runPropBKTTestOnly = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP], { testOnly: true });
    };

    runPropChainPipeline = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN]);
    };

    runPropChainTestOnly = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN], { testOnly: true });
    };

    runPropChainTreePipeline = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE]);
    };

    runPropChainTreeTestOnly = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE], { testOnly: true });
    };

    runFullCurriculumLocalLLM = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM], {
            splitOptions: {
                mode: SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST,
                testPerLesson: this.state.testPerLesson ?? 3,
                seed: "oatutor-curriculum",
            },
        });
    };

    runFullCurriculumPropBKT = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP], {
            splitOptions: {
                mode: SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST,
                testPerLesson: this.state.testPerLesson ?? 3,
                seed: "oatutor-curriculum",
            },
        });
    };

    runFullCurriculumPropChain = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN], {
            splitOptions: {
                mode: SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST,
                testPerLesson: this.state.testPerLesson ?? 3,
                seed: "oatutor-curriculum",
            },
        });
    };

    runFullCurriculumTestOnly = async () => {
        const agents = this.state.pipelineAgentTypes?.length
            ? this.state.pipelineAgentTypes
            : [AGENT_TYPES.LOCAL_LLM];
        await this.runPipelineForAgents(agents, {
            splitOptions: {
                mode: SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST,
                testPerLesson: this.state.testPerLesson ?? 3,
                seed: "oatutor-curriculum",
            },
            testOnly: true,
        });
    };

    runTestOnly = async () => {
        await this.runPipelineForAgents(ALL_AGENT_TYPES, { testOnly: true });
    };

    runStrictNoClueTestOnly = async () => {
        const agents = this.state.pipelineAgentTypes?.length
            ? this.state.pipelineAgentTypes
            : ALL_AGENT_TYPES;
        await this.runPipelineForAgents(agents, { testOnly: true, strictNoClues: true });
    };

    runStrictNoClueLocalLLM = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM], {
            testOnly: true,
            strictNoClues: true,
        });
    };

    runStrictNoCluePropBKT = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP], {
            testOnly: true,
            strictNoClues: true,
        });
    };

    runStrictNoCluePropChain = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN], {
            testOnly: true,
            strictNoClues: true,
        });
    };

    runStrictNoCluePropChainTree = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE], {
            testOnly: true,
            strictNoClues: true,
        });
    };

    runFullCurriculumPropChainTree = async () => {
        await this.runPipelineForAgents([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE], {
            splitOptions: {
                mode: SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST,
                testPerLesson: this.state.testPerLesson ?? 3,
                seed: "oatutor-curriculum",
            },
        });
    };

    handleSplitModeChange = (event) => {
        const splitMode = event.target.value;
        this.setState({ splitMode }, this.refreshSplitPreview);
    };

    handleTestPerLessonChange = (event) => {
        const value = Math.max(1, Math.min(20, Number(event.target.value) || 3));
        this.setState({ testPerLesson: value }, this.refreshSplitPreview);
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
            this.setState({ copyMessage: "JSON download started." });
        } catch (err) {
            console.error(err);
            this.setState({ copyMessage: `Download failed: ${err.message}` });
        }
    };

    downloadReportPdf = async () => {
        const { course } = this.props;
        try {
            const data = await this.resolveExportData();
            if (!data?.testEvaluation) {
                this.setState({
                    copyMessage:
                        "No test report available. Run test evaluation first, then download PDF.",
                });
                return;
            }
            downloadCurriculumTestReportPdf(data, { courseName: course?.courseName });
            this.setState({ copyMessage: "PDF report download started." });
        } catch (err) {
            console.error(err);
            this.setState({ copyMessage: `PDF export failed: ${err.message}` });
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

    renderSplitModeControls() {
        const { splitMode, testPerLesson } = this.state;
        const isFullTrain = splitMode === SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST;

        return (
            <Paper variant="outlined" style={{ padding: 16, marginTop: 16, marginBottom: 8 }}>
                <Typography variant="subtitle1" gutterBottom>
                    Train / test split strategy
                </Typography>
                <Typography variant="body2" color="textSecondary" paragraph>
                    The test set is fixed by seed and shared across all agents — every agent
                    evaluates on the exact same held-out problems for fair comparison.
                </Typography>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={6}>
                        <FormControl variant="outlined" size="small" fullWidth>
                            <InputLabel>Split mode</InputLabel>
                            <Select
                                value={splitMode}
                                onChange={this.handleSplitModeChange}
                                label="Split mode"
                            >
                                <MenuItem value={SPLIT_MODES.HOLDOUT_RATIO}>
                                    Standard (~20% holdout per lesson)
                                </MenuItem>
                                <MenuItem value={SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST}>
                                    Full curriculum train + stratified test
                                </MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                    {isFullTrain && (
                        <Grid item xs={12} sm={3}>
                            <TextField
                                label="Random test problems per lesson"
                                type="number"
                                size="small"
                                variant="outlined"
                                fullWidth
                                inputProps={{ min: 1, max: 20 }}
                                value={testPerLesson}
                                onChange={this.handleTestPerLessonChange}
                            />
                        </Grid>
                    )}
                </Grid>
                {isFullTrain && (
                    <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 8 }}>
                        Trains on (almost) every problem in each lesson/part. Test set ={" "}
                        {testPerLesson} random problem(s) per lesson (deterministic seed). Lessons
                        with only one problem contribute that problem to the test set only.
                    </Typography>
                )}
            </Paper>
        );
    }

    renderSplitOverview(split) {
        if (!split?.stats) return null;
        const isFullTrain = split.mode === SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST;
        const cards = [
            ["Lessons", split.stats.lessonCount],
            ["Parts with test problems", split.stats.lessonsWithTest ?? "—"],
            ["Train problems", split.stats.trainCount],
            ["Test problems (shared)", split.stats.testCount || split.testProblems?.length],
        ];
        if (isFullTrain) {
            cards.push(["Test per lesson", split.testPerLesson ?? this.state.testPerLesson]);
        } else {
            cards.push(["Holdout ratio", `${Math.round((split.testRatio || 0.2) * 100)}%`]);
        }

        return (
            <Grid container spacing={2}>
                {cards.map(([label, value]) => (
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
                    used during training. All agents are evaluated on this identical test set.
                    {evaluation?.strictNoClues || report?.strictNoClues ? (
                        <>
                            {" "}
                            <strong>Strict no-clue mode:</strong> hints are stripped and agents
                            cannot fall back to the hint pathway or step-answer oracle.
                        </>
                    ) : null}
                </Typography>
                {(evaluation?.strictNoClues || report?.strictNoClues) && (
                    <Chip
                        size="small"
                        label="Strict no-clue evaluation"
                        style={{ marginBottom: 12, backgroundColor: "#e8f5e9", color: "#1b5e20" }}
                    />
                )}

                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Problem</TableCell>
                            <TableCell>Lesson</TableCell>
                            {agentTypes.map((t) => (
                                <TableCell key={t} align="center" style={{ color: AGENT_META[t].color }}>
                                    {agentTableLabel(t)}
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
                            label={agentTableLabel(t)}
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

    renderResumableBanner() {
        const { checkpoint, running } = this.state;
        if (running || !this.canResumeTraining()) return null;

        const progress = checkpoint.progress || {};
        const agents = (checkpoint.agentTypes || [])
            .map((t) => AGENT_META[t]?.shortLabel || t)
            .join(", ");

        return (
            <Box
                mt={2}
                p={2}
                style={{ backgroundColor: "#fff3e0", borderRadius: 4, borderLeft: "4px solid #ef6c00" }}
            >
                <Typography variant="subtitle2" gutterBottom>
                    Interrupted training — resume available
                </Typography>
                <Typography variant="body2" paragraph style={{ lineHeight: 1.6 }}>
                    Progress saved: {progress.completedUnits || 0}/{progress.totalUnits || "?"} lesson
                    jobs ({progress.completedProblems || 0}/{progress.totalProblems || "?"} train
                    problems). Agents: {agents || "unknown"}. Export a backup before resuming if
                    you want a portable copy.
                </Typography>
                <Box display="flex" style={{ gap: 8, flexWrap: "wrap" }}>
                    <Button variant="contained" color="primary" onClick={this.resumeFromCheckpoint}>
                        Resume training
                    </Button>
                    <Button variant="outlined" onClick={this.clearCheckpoint}>
                        Discard checkpoint
                    </Button>
                </Box>
            </Box>
        );
    }

    renderTrainingProgress() {
        const { running, phase, trainingProgress, progressLabel } = this.state;
        if (!running || !trainingProgress) return null;

        const value = trainingProgress.percent || 0;
        const isTesting = phase === "testing";

        return (
            <Box mt={2} p={2} style={{ backgroundColor: "#e3f2fd", borderRadius: 4 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="subtitle2">
                        {isTesting ? "Test evaluation progress" : "Training progress"}
                    </Typography>
                    <Typography variant="body2" style={{ fontWeight: 600 }}>
                        {value}%
                    </Typography>
                </Box>
                <LinearProgress variant="determinate" value={value} style={{ height: 10, borderRadius: 4 }} />
                <Typography variant="body2" style={{ marginTop: 10, lineHeight: 1.6 }}>
                    {isTesting ? (
                        <>
                            {trainingProgress.completedUnits}/{trainingProgress.totalUnits} test
                            evaluations
                        </>
                    ) : (
                        <>
                            {trainingProgress.completedUnits}/{trainingProgress.totalUnits} lesson
                            jobs · {trainingProgress.completedProblems}/
                            {trainingProgress.totalProblems} train problems
                        </>
                    )}
                </Typography>
                {progressLabel && (
                    <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 4 }}>
                        Current: {progressLabel}
                    </Typography>
                )}
                <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 8 }}>
                    Checkpoint auto-saves after each lesson. Use{" "}
                    <strong>Agent backups</strong> above to export trained state anytime. Stop to
                    pause and resume later.
                </Typography>
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
        const trainingDone =
            checkpoint?.status === CHECKPOINT_STATUS.TRAINING_COMPLETE ||
            checkpoint?.status === CHECKPOINT_STATUS.COMPLETE ||
            !!checkpoint?.trainingCompletedAt;
        const hasSavedAgents = trainingDone;
        const hasReport = !!report?.testEvaluation || !!reportSavedAt;
        const canResume = this.canResumeTraining();

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

                    <AgentBackupPanel
                        browserStorage={this.props.browserStorage}
                        lessons={this.props.lessons}
                        courseName={course.courseName}
                        scope="course"
                        defaultOpen
                    />

                    {this.renderSplitModeControls()}
                    {this.renderSplitOverview(split)}
                    {this.renderTrainBreakdown(split)}

                    {this.renderResumableBanner()}

                    {(hasSavedAgents || hasReport || canResume) && (
                        <Box mt={2} p={1.5} style={{ backgroundColor: "#e8f5e9", borderRadius: 4 }}>
                            <Typography variant="body2">
                                {canResume &&
                                    `Checkpoint: ${checkpoint.progress?.completedUnits || 0}/${checkpoint.progress?.totalUnits || "?"} lesson jobs complete — resume or export backup.`}
                                {hasSavedAgents &&
                                    ` Training complete ${checkpoint.trainingCompletedAt ? new Date(checkpoint.trainingCompletedAt).toLocaleString() : ""} — agent states persist per lesson.`}
                                {hasReport &&
                                    ` Report saved ${reportSavedAt ? new Date(reportSavedAt).toLocaleString() : ""}.`}
                            </Typography>
                        </Box>
                    )}

                    {this.renderTrainingProgress()}

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
                            {running && phase === "testing" && !this.state.strictNoClueTest
                                ? "Running test set..."
                                : "Run Test Set Only (use saved agents)"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#1b5e20", color: "#fff" }}
                            onClick={this.runStrictNoClueTestOnly}
                            disabled={running || !split?.stats?.testCount}
                        >
                            {running && phase === "testing" && this.state.strictNoClueTest
                                ? "Strict no-clue test..."
                                : "Strict No-Clue Test (reasoning only)"}
                        </Button>
                    </Box>
                    <Typography variant="caption" color="textSecondary" display="block" style={{ marginTop: 4, marginBottom: 12 }}>
                        Standard test allows hint rescue on failure. Strict no-clue uses the same
                        held-out problems but strips hints — trained beliefs/chains still apply in
                        the prompt.
                    </Typography>
                    <Box display="flex" style={{ gap: 12, flexWrap: "wrap" }}>
                        <Button
                            variant="outlined"
                            style={{ borderColor: "#1b5e20", color: "#1b5e20" }}
                            onClick={this.runStrictNoClueLocalLLM}
                            disabled={running || !split?.stats?.testCount}
                        >
                            GPT-OSS strict no-clue
                        </Button>
                        <Button
                            variant="outlined"
                            style={{ borderColor: "#1b5e20", color: "#1b5e20" }}
                            onClick={this.runStrictNoCluePropBKT}
                            disabled={running || !split?.stats?.testCount}
                        >
                            Prop BKT strict no-clue
                        </Button>
                        <Button
                            variant="outlined"
                            style={{ borderColor: "#1b5e20", color: "#1b5e20" }}
                            onClick={this.runStrictNoCluePropChain}
                            disabled={running || !split?.stats?.testCount}
                        >
                            Prop Chain strict no-clue
                        </Button>
                        <Button
                            variant="outlined"
                            style={{ borderColor: "#1b5e20", color: "#1b5e20" }}
                            onClick={this.runStrictNoCluePropChainTree}
                            disabled={running || !split?.stats?.testCount}
                        >
                            Prop Tree strict no-clue
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
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM
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
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM
                                ? "Testing local GPT-OSS..."
                                : "Local GPT-OSS Test Only"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#6a1b9a", color: "#fff" }}
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runPropBKTPipeline}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running &&
                            phase === "training" &&
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM_PROP
                                ? "[Prop-BKT] Training..."
                                : "Train Propositional BKT & Run Test Set"}
                        </Button>
                        <Button
                            variant="outlined"
                            style={{ borderColor: "#6a1b9a", color: "#6a1b9a" }}
                            onClick={this.runPropBKTTestOnly}
                            disabled={running || !split?.stats?.testCount}
                        >
                            {running &&
                            phase === "testing" &&
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM_PROP
                                ? "[Prop-BKT] Testing..."
                                : "Propositional BKT Test Only"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#4527a0", color: "#fff" }}
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runPropChainPipeline}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running &&
                            phase === "training" &&
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN
                                ? "[Prop-Chain] Training..."
                                : "Train Prop Chain & Run Test Set"}
                        </Button>
                        <Button
                            variant="outlined"
                            style={{ borderColor: "#4527a0", color: "#4527a0" }}
                            onClick={this.runPropChainTestOnly}
                            disabled={running || !split?.stats?.testCount}
                        >
                            {running &&
                            phase === "testing" &&
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN
                                ? "[Prop-Chain] Testing..."
                                : "Prop Chain Test Only"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#283593", color: "#fff" }}
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runPropChainTreePipeline}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running &&
                            phase === "training" &&
                            this.state.pipelineAgentTypes?.[0] ===
                                AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE
                                ? "[Prop-Tree] Training..."
                                : "Train Prop Chain Tree & Run Test"}
                        </Button>
                        <Button
                            variant="outlined"
                            style={{ borderColor: "#283593", color: "#283593" }}
                            onClick={this.runPropChainTreeTestOnly}
                            disabled={running || !split?.stats?.testCount}
                        >
                            {running &&
                            phase === "testing" &&
                            this.state.pipelineAgentTypes?.[0] ===
                                AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE
                                ? "[Prop-Tree] Testing..."
                                : "Prop Chain Tree Test Only"}
                        </Button>
                    </Box>

                    <Divider style={{ margin: "16px 0" }} />

                    <Typography variant="subtitle1" gutterBottom>
                        Full curriculum mode (train on all parts)
                    </Typography>
                    <Typography variant="body2" color="textSecondary" paragraph>
                        Train on nearly every problem in each lesson, then evaluate on a shared
                        random sample from every part. Use the split controls above to set how many
                        test problems per lesson.
                    </Typography>
                    <Box display="flex" style={{ gap: 12, flexWrap: "wrap" }}>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#bf360c", color: "#fff" }}
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runFullCurriculumLocalLLM}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running &&
                            phase === "training" &&
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM &&
                            this.state.splitMode === SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST
                                ? "Full curriculum GPT-OSS training..."
                                : "Full Curriculum: GPT-OSS + Shared Test"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#4a148c", color: "#fff" }}
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runFullCurriculumPropBKT}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running &&
                            phase === "training" &&
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM_PROP &&
                            this.state.splitMode === SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST
                                ? "Full curriculum Prop BKT training..."
                                : "Full Curriculum: Prop BKT + Shared Test"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#311b92", color: "#fff" }}
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runFullCurriculumPropChain}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running &&
                            phase === "training" &&
                            this.state.pipelineAgentTypes?.[0] === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN &&
                            this.state.splitMode === SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST
                                ? "Full curriculum Prop Chain training..."
                                : "Full Curriculum: Prop Chain + Shared Test"}
                        </Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: "#1a237e", color: "#fff" }}
                            startIcon={<PlayArrowIcon />}
                            onClick={this.runFullCurriculumPropChainTree}
                            disabled={running || !split?.stats?.trainCount}
                        >
                            {running &&
                            phase === "training" &&
                            this.state.pipelineAgentTypes?.[0] ===
                                AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE &&
                            this.state.splitMode === SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST
                                ? "Full curriculum Prop Tree training..."
                                : "Full Curriculum: Prop Tree + Shared Test"}
                        </Button>
                        <Button
                            variant="outlined"
                            onClick={this.runFullCurriculumTestOnly}
                            disabled={running || !split?.stats?.testCount}
                        >
                            {running && phase === "testing"
                                ? "Running shared stratified test..."
                                : "Run Shared Stratified Test Only"}
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
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<GetAppIcon />}
                            onClick={this.downloadReportPdf}
                            disabled={!hasReport}
                        >
                            Download PDF report
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

                    {running && !this.state.trainingProgress && (
                        <Box mt={2}>
                            <LinearProgress />
                            <Typography variant="caption" color="textSecondary">
                                Phase: {phase || "starting"}…
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
                            {report.strictNoClues || report.testEvaluation?.strictNoClues ? (
                                <Chip
                                    label="Strict no-clue test results"
                                    style={{
                                        marginTop: 16,
                                        marginBottom: 8,
                                        marginRight: 8,
                                        backgroundColor: "#e8f5e9",
                                        color: "#1b5e20",
                                    }}
                                />
                            ) : null}
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
