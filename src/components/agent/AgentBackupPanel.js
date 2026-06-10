import React from "react";
import {
    Box,
    Button,
    Checkbox,
    Collapse,
    FormControlLabel,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
    Chip,
} from "@material-ui/core";
import BackupIcon from "@material-ui/icons/Backup";
import CloudUploadIcon from "@material-ui/icons/CloudUpload";
import GetAppIcon from "@material-ui/icons/GetApp";
import RefreshIcon from "@material-ui/icons/Refresh";
import ExpandMoreIcon from "@material-ui/icons/ExpandMore";
import ExpandLessIcon from "@material-ui/icons/ExpandLess";
import { AGENT_META, AGENT_TYPES } from "../../agent/agentTypes.js";
import {
    AGENT_SLOT_LABELS,
    defaultBackupFilename,
    downloadAgentBackupFile,
    exportCourseAgentBackup,
    exportLessonAgentBackup,
    getDefaultExportAgentTypes,
    importAgentBackup,
    parseAgentBackupFile,
    scanLessonAgentState,
    summarizeAgentBackup,
} from "../../agent/agentStateBackup.js";

const ALL_EXPORT_TYPES = getDefaultExportAgentTypes();

class AgentBackupPanel extends React.Component {
    constructor(props) {
        super(props);
        this.fileInputRef = React.createRef();
        this.state = {
            open: props.defaultOpen || false,
            loading: false,
            savedSlots: [],
            exportAgentTypes: [...ALL_EXPORT_TYPES],
            includeReports: false,
            pendingBackup: null,
            pendingSummary: null,
            importAgentTypes: [],
            message: null,
            messageTone: "info",
            busy: false,
        };
    }

    componentDidMount() {
        this.refreshSavedState();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.lesson?.id !== this.props.lesson?.id) {
            this.refreshSavedState();
        }
    }

    setMessage = (message, tone = "info") => {
        this.setState({ message, messageTone: tone });
    };

    refreshSavedState = async () => {
        const { browserStorage, lesson, scope } = this.props;
        if (!browserStorage || scope !== "lesson" || !lesson?.id) {
            this.setState({ savedSlots: [], loading: false });
            return;
        }
        this.setState({ loading: true });
        const savedSlots = await scanLessonAgentState(browserStorage, lesson.id, ALL_EXPORT_TYPES, {
            includeReports: true,
        });
        this.setState({ savedSlots, loading: false });
    };

    toggleExportType = (agentType) => {
        this.setState((prev) => {
            const selected = new Set(prev.exportAgentTypes);
            if (selected.has(agentType)) selected.delete(agentType);
            else selected.add(agentType);
            return { exportAgentTypes: [...selected] };
        });
    };

    toggleImportType = (agentType) => {
        this.setState((prev) => {
            const selected = new Set(prev.importAgentTypes);
            if (selected.has(agentType)) selected.delete(agentType);
            else selected.add(agentType);
            return { importAgentTypes: [...selected] };
        });
    };

    selectImportPreset = (agentTypes) => {
        this.setState({ importAgentTypes: [...agentTypes] });
    };

    handleExport = async () => {
        const { browserStorage, lesson, lessons, courseName, scope } = this.props;
        const { exportAgentTypes, includeReports } = this.state;
        if (!browserStorage) {
            this.setMessage("Browser storage is unavailable.", "error");
            return;
        }
        if (exportAgentTypes.length === 0) {
            this.setMessage("Select at least one agent type to export.", "error");
            return;
        }

        this.setState({ busy: true });
        try {
            let backup;
            if (scope === "course") {
                backup = await exportCourseAgentBackup(browserStorage, {
                    courseName,
                    lessons: lessons || [],
                    agentTypes: exportAgentTypes,
                    includeReports,
                    includeCurriculum: true,
                });
            } else {
                if (!lesson?.id) {
                    throw new Error("No lesson selected.");
                }
                backup = await exportLessonAgentBackup(browserStorage, {
                    lessonId: lesson.id,
                    lessonTitle: lesson.name || lesson.title,
                    agentTypes: exportAgentTypes,
                    includeReports,
                });
            }

            const entryCount =
                backup.scope === "course"
                    ? (backup.lessons || []).reduce((n, l) => n + (l.entries?.length || 0), 0)
                    : (backup.entries || []).length;

            if (entryCount === 0 && !backup.curriculum) {
                this.setMessage("Nothing trained yet — run training first, then export.", "error");
                return;
            }

            const filename = defaultBackupFilename({
                scope: backup.scope,
                lessonId: lesson?.id,
                courseName,
            });
            downloadAgentBackupFile(backup, filename);
            this.setMessage(
                `Exported ${entryCount} saved state block(s) to ${filename}.`,
                "success"
            );
            this.props.onExportComplete?.(backup);
        } catch (err) {
            this.setMessage(err.message || "Export failed.", "error");
        } finally {
            this.setState({ busy: false });
        }
    };

    handleChooseFile = () => {
        this.fileInputRef.current?.click();
    };

    handleFileSelected = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        this.setState({ busy: true });
        try {
            const pendingBackup = await parseAgentBackupFile(file);
            const pendingSummary = summarizeAgentBackup(pendingBackup);
            const importAgentTypes =
                pendingSummary.agentTypes?.length > 0
                    ? [...pendingSummary.agentTypes]
                    : [
                          ...new Set(
                              (pendingSummary.lessons || [])
                                  .flatMap((l) => l.agentTypes || [])
                                  .filter(Boolean)
                          ),
                      ];
            this.setState({
                pendingBackup,
                pendingSummary,
                importAgentTypes,
                message: null,
            });
        } catch (err) {
            this.setMessage(err.message || "Could not read backup file.", "error");
            this.setState({ pendingBackup: null, pendingSummary: null });
        } finally {
            this.setState({ busy: false });
        }
    };

    handleImport = async () => {
        const { browserStorage, lesson, courseName } = this.props;
        const { pendingBackup, importAgentTypes } = this.state;
        if (!browserStorage || !pendingBackup) return;
        if (importAgentTypes.length === 0) {
            this.setMessage("Select at least one agent type to restore.", "error");
            return;
        }

        this.setState({ busy: true });
        try {
            const result = await importAgentBackup(browserStorage, pendingBackup, {
                agentTypes: importAgentTypes,
                targetLessonId: lesson?.id,
                targetCourseName: courseName,
            });
            this.setMessage(
                `Restored ${result.restored} state block(s). You can evaluate or train without starting from scratch.`,
                "success"
            );
            this.setState({ pendingBackup: null, pendingSummary: null });
            await this.refreshSavedState();
            this.props.onImportComplete?.(result);
        } catch (err) {
            this.setMessage(err.message || "Import failed.", "error");
        } finally {
            this.setState({ busy: false });
        }
    };

    handleCancelImport = () => {
        this.setState({ pendingBackup: null, pendingSummary: null, message: null });
    };

    renderAgentTypeCheckboxes(selected, onToggle) {
        return (
            <Box display="flex" flexWrap="wrap" style={{ gap: 4 }}>
                {ALL_EXPORT_TYPES.map((type) => {
                    const meta = AGENT_META[type];
                    return (
                        <FormControlLabel
                            key={type}
                            control={
                                <Checkbox
                                    size="small"
                                    color="primary"
                                    checked={selected.includes(type)}
                                    onChange={() => onToggle(type)}
                                />
                            }
                            label={
                                <Typography variant="body2" style={{ fontSize: 13 }}>
                                    {meta?.shortLabel || type}
                                </Typography>
                            }
                        />
                    );
                })}
            </Box>
        );
    }

    renderSavedState() {
        const { scope } = this.props;
        const { savedSlots, loading } = this.state;
        if (scope !== "lesson") return null;

        if (loading) {
            return (
                <Typography variant="body2" color="textSecondary" paragraph>
                    Checking saved training state…
                </Typography>
            );
        }

        if (savedSlots.length === 0) {
            return (
                <Typography variant="body2" color="textSecondary" paragraph>
                    No trained agent state saved in this browser for this lesson yet.
                </Typography>
            );
        }

        return (
            <Box mb={2}>
                <Typography variant="subtitle2" gutterBottom>
                    Saved in this browser (this lesson)
                </Typography>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Agent</TableCell>
                            <TableCell>Component</TableCell>
                            <TableCell>Status</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {savedSlots.map((slot) => (
                            <TableRow key={`${slot.storageKey}-${slot.slot}`}>
                                <TableCell>
                                    {slot.agentType
                                        ? AGENT_META[slot.agentType]?.shortLabel || slot.agentType
                                        : "Report"}
                                </TableCell>
                                <TableCell>{AGENT_SLOT_LABELS[slot.slot] || slot.slot}</TableCell>
                                <TableCell>
                                    <Typography variant="body2" style={{ fontSize: 12 }}>
                                        {slot.summary}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Box>
        );
    }

    renderImportPreview() {
        const { pendingSummary, importAgentTypes } = this.state;
        if (!pendingSummary?.valid) return null;

        return (
            <Paper variant="outlined" style={{ padding: 12, marginTop: 12, backgroundColor: "#f5f5f5" }}>
                <Typography variant="subtitle2" gutterBottom>
                    Backup preview
                </Typography>
                <Typography variant="body2" paragraph style={{ lineHeight: 1.6 }}>
                    {pendingSummary.scope === "course" ? (
                        <>
                            Course backup for <strong>{pendingSummary.courseName}</strong> —{" "}
                            {pendingSummary.lessonCount} lesson(s), {pendingSummary.totalEntries}{" "}
                            state block(s)
                            {pendingSummary.exportedAt
                                ? ` (exported ${new Date(pendingSummary.exportedAt).toLocaleString()})`
                                : ""}
                        </>
                    ) : (
                        <>
                            Lesson backup for <strong>{pendingSummary.lessonTitle}</strong> —{" "}
                            {pendingSummary.entryCount} state block(s)
                            {pendingSummary.exportedAt
                                ? ` (exported ${new Date(pendingSummary.exportedAt).toLocaleString()})`
                                : ""}
                        </>
                    )}
                </Typography>

                {pendingSummary.scope === "lesson" && (
                    <Box mb={1}>
                        {(pendingSummary.slots || []).map((s, i) => (
                            <Chip
                                key={i}
                                size="small"
                                label={`${AGENT_META[s.agentType]?.shortLabel || s.agentType}: ${s.label}`}
                                style={{ margin: "2px 4px 2px 0", fontSize: 11 }}
                            />
                        ))}
                    </Box>
                )}

                <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                    Restore which agents?
                </Typography>
                {this.renderAgentTypeCheckboxes(importAgentTypes, this.toggleImportType)}

                <Box mt={1} display="flex" style={{ gap: 8, flexWrap: "wrap" }}>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => this.selectImportPreset([AGENT_TYPES.LOCAL_LLM])}
                    >
                        GPT-OSS only
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => this.selectImportPreset([AGENT_TYPES.LOCAL_LLM_PROP])}
                    >
                        Prop BKT only
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => this.selectImportPreset([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN])}
                    >
                        Prop Chain only
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => this.selectImportPreset([AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE])}
                    >
                        Prop Tree only
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => this.selectImportPreset([...ALL_EXPORT_TYPES])}
                    >
                        All agents
                    </Button>
                </Box>

                <Box mt={2} display="flex" style={{ gap: 8 }}>
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={<CloudUploadIcon />}
                        onClick={this.handleImport}
                        disabled={this.state.busy}
                    >
                        Restore selected agents
                    </Button>
                    <Button variant="text" onClick={this.handleCancelImport} disabled={this.state.busy}>
                        Cancel
                    </Button>
                </Box>
            </Paper>
        );
    }

    render() {
        const { scope } = this.props;
        const { open, exportAgentTypes, includeReports, message, messageTone, busy } = this.state;

        return (
            <Paper variant="outlined" style={{ padding: 16, marginTop: 16, marginBottom: 16 }}>
                <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    style={{ cursor: "pointer" }}
                    onClick={() => this.setState({ open: !open })}
                >
                    <Box display="flex" alignItems="center">
                        <BackupIcon style={{ marginRight: 8, color: "#1565c0" }} />
                        <Box>
                            <Typography variant="subtitle1">
                                Agent backups — export / import trained state
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                                Save GPT-OSS, Prop BKT, Memory, RL, or LLM training to a file and
                                restore on another machine
                            </Typography>
                        </Box>
                    </Box>
                    {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </Box>

                <Collapse in={open}>
                    <Box mt={2}>
                        {this.renderSavedState()}

                        <Typography variant="subtitle2" gutterBottom>
                            Export
                        </Typography>
                        <Typography variant="body2" color="textSecondary" paragraph>
                            {scope === "course"
                                ? "Download trained agent state for all lessons in this course."
                                : "Download trained agent state for this lesson."}
                        </Typography>

                        {this.renderAgentTypeCheckboxes(exportAgentTypes, this.toggleExportType)}

                        <FormControlLabel
                            control={
                                <Checkbox
                                    size="small"
                                    checked={includeReports}
                                    onChange={(e) => this.setState({ includeReports: e.target.checked })}
                                />
                            }
                            label={
                                <Typography variant="body2" style={{ fontSize: 13 }}>
                                    Include evaluation & comparison reports
                                </Typography>
                            }
                        />

                        <Box mt={1} display="flex" style={{ gap: 8, flexWrap: "wrap" }}>
                            <Button
                                variant="contained"
                                color="primary"
                                startIcon={<GetAppIcon />}
                                onClick={this.handleExport}
                                disabled={busy}
                            >
                                Download backup (.json)
                            </Button>
                            {scope === "lesson" && (
                                <Button
                                    variant="outlined"
                                    startIcon={<RefreshIcon />}
                                    onClick={this.refreshSavedState}
                                    disabled={busy}
                                >
                                    Refresh
                                </Button>
                            )}
                        </Box>

                        <Box mt={3}>
                            <Typography variant="subtitle2" gutterBottom>
                                Import
                            </Typography>
                            <Typography variant="body2" color="textSecondary" paragraph>
                                Upload a backup file to skip retraining. You can restore only GPT-OSS,
                                only Prop BKT, or any combination.
                            </Typography>
                            <input
                                ref={this.fileInputRef}
                                type="file"
                                accept="application/json,.json"
                                style={{ display: "none" }}
                                onChange={this.handleFileSelected}
                            />
                            <Button
                                variant="outlined"
                                color="primary"
                                startIcon={<CloudUploadIcon />}
                                onClick={this.handleChooseFile}
                                disabled={busy}
                            >
                                Choose backup file…
                            </Button>
                            {this.renderImportPreview()}
                        </Box>

                        {message && (
                            <Box
                                mt={2}
                                p={1.5}
                                style={{
                                    borderRadius: 4,
                                    backgroundColor:
                                        messageTone === "error"
                                            ? "#ffebee"
                                            : messageTone === "success"
                                              ? "#e8f5e9"
                                              : "#e3f2fd",
                                }}
                            >
                                <Typography variant="body2">{message}</Typography>
                            </Box>
                        )}
                    </Box>
                </Collapse>
            </Paper>
        );
    }
}

export default AgentBackupPanel;
