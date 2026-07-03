import express, { Router } from 'express';
import { getAdminConfig, getAdminTestConfig } from '../lib/config.js';
import {
  assetErrorSummary,
  getAsset,
  listAssets,
  registerAsset,
} from '../lib/assets.js';
import { getAdminChecks } from '../lib/admin-checks.js';
import {
  CLEAN_TEST_ARTIFACTS_CONFIRMATION,
  adminCleanupErrorSummary,
  cleanupProductionTestArtifacts,
  previewProductionTestArtifacts,
} from '../lib/admin-cleanup.js';
import {
  adminCookieName,
  adminIsConfigured,
  createAdminCookie,
  passwordHashHelp,
  readCookies,
  verifyAdminCookie,
  verifyAdminCredentials,
} from '../lib/admin-auth.js';
import { loadContent } from '../lib/content-store/index.js';
import {
  SOURCE_KINDS,
  TRUST_LEVELS,
  createDiscoverySource,
  discoverySourceErrorSummary,
  getDiscoverySource,
  listDiscoverySources,
  setDiscoverySourceEnabled,
  updateDiscoverySource,
} from '../lib/discovery-sources.js';
import {
  createDiffFromParseResult,
  createDiffFromExtractionResult,
  diffResultErrorSummary,
  getDiffResult,
  listDiffResults,
  listDiffResultsForParseResult,
} from '../lib/diff-results.js';
import {
  extractionResultErrorSummary,
  getExtractionResult,
  listExtractionResults,
  listExtractionResultsForParseResult,
  runEntityExtraction,
} from '../lib/extraction-results.js';
import { parseMultipartForm, readRequestBuffer } from '../lib/multipart.js';
import {
  getPipelineRun,
  listPipelineRuns,
  listPipelineRunsForAsset,
  pipelineErrorSummary,
  runManualEvidencePipeline,
} from '../lib/evidence-pipeline.js';
import { fetchSourceUrl, sourceFetchErrorSummary } from '../lib/source-fetcher.js';
import {
  getParseResult,
  listParseResults,
  listParseResultsForAsset,
  parseResultErrorSummary,
  runParser,
} from '../lib/parse-results.js';
import { listParsersForAsset } from '../lib/parsers/index.js';
import {
  createContentProposal,
  createContentProposalFromDiffResult,
  getContentProposal,
  getContentProposalByDiffResult,
  listContentProposals,
  proposalErrorSummary,
  reviewContentProposal,
  validateContentProposal,
} from '../lib/proposals.js';
import {
  exportProposalForReview,
  getProposalExport,
  listProposalExports,
  proposalExportErrorSummary,
} from '../lib/proposal-export.js';
import {
  addProposalToReleaseCandidate,
  applyReleaseCandidateItemDraft,
  createReleaseCandidate,
  exportReleaseCandidateItem,
  getReleaseCandidate,
  listApprovedProposalsForRelease,
  listReleaseCandidates,
  markReleaseCandidateReady,
  releaseCandidateErrorSummary,
  removeProposalFromReleaseCandidate,
} from '../lib/release-candidates.js';
import {
  generateReleaseReviewSummary,
  releaseReviewErrorSummary,
} from '../lib/release-review.js';
import {
  generateReleaseApplyPlan,
  getReleaseApplyPlan,
  releaseApplyPlanErrorSummary,
} from '../lib/release-apply-plan.js';
import {
  LIVE_APPLY_CONFIRMATION,
  LIVE_ROLLBACK_CONFIRMATION,
  applyReleaseToLiveJson,
  getLatestReleaseLiveApply,
  getReleaseLiveApply,
  releaseLiveApplyErrorSummary,
  rollbackReleaseLiveApply,
} from '../lib/release-live-apply.js';
import {
  cleanupTestFixtures,
  runReleaseCandidateDryRun,
  testFixtureErrorSummary,
} from '../lib/test-fixtures.js';
import {
  applyProposalExportToDraft,
  getProposalDraftApply,
  listProposalDraftApplies,
  proposalDraftApplyErrorSummary,
} from '../lib/proposal-apply-draft.js';
import {
  compareRevisions,
  contentRevisionErrorSummary,
  getRevision,
  listRevisionEntities,
  listRevisions,
} from '../lib/content-revisions.js';
import {
  renderAdminConfigError,
  renderAdminCleanupPage,
  renderAdminChecksPage,
  renderAdminTestToolsPage,
  renderReleaseApplyPlanDetailPage,
  renderReleaseLiveApplyDetailPage,
  renderAssetDetailPage,
  renderAssetUploadPage,
  renderAssetsPage,
  renderAssetsUnavailablePage,
  renderBranchProfilesPage,
  renderCollegesPage,
  renderDashboard,
  renderDiffResultDetailPage,
  renderDiffResultsPage,
  renderExtractionResultDetailPage,
  renderExtractionResultsPage,
  renderLoginPage,
  renderPipelineRunDetailPage,
  renderPipelineRunsPage,
  renderProposalExportDetailPage,
  renderProposalDraftApplyDetailPage,
  renderProposalCreatePage,
  renderProposalDetailPage,
  renderProposalUnavailablePage,
  renderProposalsPage,
  renderReleaseCandidateCreatePage,
  renderReleaseCandidateDetailPage,
  renderReleaseCandidateUnavailablePage,
  renderReleaseCandidatesPage,
  renderParseResultDetailPage,
  renderParseResultsPage,
  renderRevisionComparisonPage,
  renderRevisionDetailPage,
  renderRevisionEntityPage,
  renderRevisionsPage,
  renderSourceDetailPage,
  renderSourceEvidencePage,
  renderSourceFormPage,
  renderSourceRegistryPage,
  renderSourceUnavailablePage,
  renderSubjectsPage,
} from '../templates/admin.js';

function statusCounts(subjects) {
  return subjects.reduce((acc, subject) => {
    const status = subject.source?.status || 'missing';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function collectSources(content) {
  const seen = new Set();
  const sources = [];
  const add = (entityType, source) => {
    if (!source) return;
    const row = {
      entityType,
      status: source.status || '',
      retrievedDate: source.retrieved_date || '',
      originUrl: source.origin_url || '',
      note: source.college_source_note || '',
    };
    const key = JSON.stringify(row);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(row);
  };

  for (const regulation of content.data.regulations || []) {
    add('regulation', {
      status: regulation.status === 'unconfirmed' ? 'needs_verification' : 'verified',
      retrieved_date: regulation.last_verified,
      origin_url: regulation.source_url,
    });
  }
  for (const branch of content.data.branches || []) add('branch', branch.source);
  for (const subject of content.data.subjects || []) add('subject', subject.source);
  for (const college of content.colleges || []) add('college', college.source);
  for (const profile of content.branchProfiles || []) add('branch_profile', profile.source);
  return sources.sort((a, b) => `${a.entityType}:${a.originUrl}`.localeCompare(`${b.entityType}:${b.originUrl}`));
}

function parseSourceId(value) {
  if (!value || !String(value).trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Source ID must be a positive integer when provided.');
  }
  return parsed;
}

function sourceFormValues(source) {
  return {
    source_key: source.sourceKey,
    name: source.name,
    base_url: source.baseUrl,
    university_id: source.universityId || '',
    branch_id: source.branchId || '',
    source_kind: source.sourceKind,
    trust_level: source.trustLevel,
    enabled: source.enabled ? '1' : '',
    crawl_enabled: source.crawlEnabled ? '1' : '',
    parser_key: source.parserKey || '',
    notes: source.notes || '',
  };
}

function sourceFormOptions() {
  return {
    sourceKinds: SOURCE_KINDS,
    trustLevels: TRUST_LEVELS,
  };
}

function requireAdmin(config) {
  return (req, res, next) => {
    if (!adminIsConfigured(config)) {
      res.status(503).send(renderAdminConfigError({
        message: `ADMIN_ENABLED is true, but admin credentials are incomplete. Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH. ${passwordHashHelp()}`,
      }));
      return;
    }

    const cookies = readCookies(req);
    if (verifyAdminCookie(cookies[adminCookieName()], config)) {
      next();
      return;
    }
    res.redirect('/admin/login');
  };
}

async function getContent(root) {
  return loadContent({ root });
}

export function createAdminRouter({ root }) {
  const router = Router();
  const config = getAdminConfig();
  const testConfig = getAdminTestConfig();

  router.use((req, res, next) => {
    if (!config.enabled) {
      res.status(404).send('Not found');
      return;
    }
    next();
  });

  router.use((req, res, next) => {
    if (req.path === '/login') return next();
    return requireAdmin(config)(req, res, next);
  });

  router.get('/login', (req, res) => {
    if (!adminIsConfigured(config)) {
      res.status(503).send(renderAdminConfigError({
        message: `ADMIN_ENABLED is true, but admin credentials are incomplete. Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH. ${passwordHashHelp()}`,
      }));
      return;
    }
    res.send(renderLoginPage());
  });

  router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    if (!verifyAdminCredentials(req.body || {}, config)) {
      res.status(401).send(renderLoginPage({ error: 'Invalid email or password.' }));
      return;
    }
    const cookie = createAdminCookie(config.email, config);
    res.cookie(adminCookieName(), cookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/admin',
      maxAge: 1000 * 60 * 60 * 8,
    });
    res.redirect('/admin/');
  });

  router.get('/logout', (req, res) => {
    res.clearCookie(adminCookieName(), { path: '/admin' });
    res.redirect('/admin/login');
  });

  router.get('/', async (req, res, next) => {
    try {
      const content = await getContent(root);
      const countsByStatus = statusCounts(content.data.subjects);
      res.send(renderDashboard({
        contentSource: content.source,
        counts: {
          subjectsTotal: content.data.subjects.length,
          subjectsVerified: countsByStatus.verified || 0,
          subjectsNeedsVerification: countsByStatus.needs_verification || 0,
          subjectsPlaceholder: countsByStatus.placeholder || 0,
          collegesTotal: content.colleges.length,
          branchProfilesTotal: content.branchProfiles.length,
        },
      }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/checks', async (req, res, next) => {
    try {
      const checks = await getAdminChecks({ root });
      res.send(renderAdminChecksPage({ checks }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/cleanup', async (req, res) => {
    try {
      const preview = await previewProductionTestArtifacts();
      res.send(renderAdminCleanupPage({
        preview,
        confirmationPhrase: CLEAN_TEST_ARTIFACTS_CONFIRMATION,
      }));
    } catch (err) {
      res.status(503).send(renderAdminCleanupPage({
        preview: null,
        confirmationPhrase: CLEAN_TEST_ARTIFACTS_CONFIRMATION,
        error: adminCleanupErrorSummary(err),
      }));
    }
  });

  router.post('/cleanup/test-artifacts', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    try {
      const result = await cleanupProductionTestArtifacts({
        root,
        confirmationPhrase: req.body?.confirmation_phrase,
        actor: config.email,
      });
      const preview = await previewProductionTestArtifacts();
      res.send(renderAdminCleanupPage({
        preview,
        result,
        confirmationPhrase: CLEAN_TEST_ARTIFACTS_CONFIRMATION,
      }));
    } catch (err) {
      let preview = null;
      try {
        preview = await previewProductionTestArtifacts();
      } catch {
        // The cleanup error is the useful one for the operator.
      }
      res.status(400).send(renderAdminCleanupPage({
        preview,
        confirmationPhrase: CLEAN_TEST_ARTIFACTS_CONFIRMATION,
        error: adminCleanupErrorSummary(err),
      }));
    }
  });

  router.get('/test-tools', async (req, res) => {
    if (!testConfig.enabled) {
      res.status(404).send('Not found');
      return;
    }
    res.send(renderAdminTestToolsPage({ enabled: true }));
  });

  router.post('/test-tools/release-dry-run', express.urlencoded({ extended: false }), async (req, res) => {
    if (!testConfig.enabled) {
      res.status(404).send('Not found');
      return;
    }
    try {
      const result = await runReleaseCandidateDryRun({ root, actor: config.email });
      res.send(renderAdminTestToolsPage({ enabled: true, result }));
    } catch (err) {
      res.status(400).send(renderAdminTestToolsPage({
        enabled: true,
        error: testFixtureErrorSummary(err),
      }));
    }
  });

  router.post('/test-tools/cleanup', express.urlencoded({ extended: false }), async (req, res) => {
    if (!testConfig.enabled) {
      res.status(404).send('Not found');
      return;
    }
    try {
      const cleanup = await cleanupTestFixtures({ root, actor: config.email });
      res.send(renderAdminTestToolsPage({ enabled: true, cleanup }));
    } catch (err) {
      res.status(400).send(renderAdminTestToolsPage({
        enabled: true,
        error: testFixtureErrorSummary(err),
      }));
    }
  });

  router.get('/subjects', async (req, res, next) => {
    try {
      const content = await getContent(root);
      res.send(renderSubjectsPage({ subjects: content.data.subjects, contentSource: content.source }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/colleges', async (req, res, next) => {
    try {
      const content = await getContent(root);
      res.send(renderCollegesPage({ colleges: content.colleges, contentSource: content.source }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/branch-profiles', async (req, res, next) => {
    try {
      const content = await getContent(root);
      res.send(renderBranchProfilesPage({ branchProfiles: content.branchProfiles, contentSource: content.source }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/sources', async (req, res, next) => {
    try {
      const sources = await listDiscoverySources();
      res.send(renderSourceRegistryPage({ sources }));
    } catch (err) {
      res.status(503).send(renderSourceUnavailablePage({ message: discoverySourceErrorSummary(err) }));
    }
  });

  router.get('/assets', async (req, res) => {
    try {
      const assets = await listAssets();
      res.send(renderAssetsPage({ assets }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: assetErrorSummary(err) }));
    }
  });

  router.get('/assets/new', async (req, res) => {
    try {
      const sources = await listDiscoverySources();
      res.send(renderAssetUploadPage({ sources }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: assetErrorSummary(err) }));
    }
  });

  router.post('/assets/new', async (req, res) => {
    let fields = {};
    let sources = [];
    try {
      const body = await readRequestBuffer(req, { limitBytes: 30 * 1024 * 1024 });
      const parsed = parseMultipartForm(body, req.headers['content-type']);
      fields = parsed.fields;
      if (!parsed.file) throw new Error('Choose a file to upload.');

      const result = await registerAsset({
        root,
        discoverySourceId: fields.discovery_source_id,
        sourceUrl: fields.source_url,
        originalFilename: parsed.file.filename,
        contentType: parsed.file.contentType,
        buffer: parsed.file.buffer,
        actor: config.email,
      });
      res.redirect(`/admin/assets/${result.asset.id}`);
    } catch (err) {
      try {
        sources = await listDiscoverySources();
      } catch {
        sources = [];
      }
      res.status(400).send(renderAssetUploadPage({
        sources,
        values: fields,
        error: assetErrorSummary(err),
      }));
    }
  });

  router.get('/assets/:id', async (req, res) => {
    try {
      const asset = await getAsset(req.params.id);
      if (!asset) {
        res.status(404).send(renderAssetsUnavailablePage({ message: 'Source asset not found.' }));
        return;
      }
      const parsers = listParsersForAsset(asset);
      const parseResults = await listParseResultsForAsset(asset.id);
      const pipelineRuns = await listPipelineRunsForAsset(asset.id);
      res.send(renderAssetDetailPage({ asset, parsers, parseResults, pipelineRuns }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: assetErrorSummary(err) }));
    }
  });

  router.post('/assets/:id/parse', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const result = await runParser({
        root,
        assetId: req.params.id,
        parserKey: req.body?.parser_key,
        actor: config.email,
      });
      res.redirect(`/admin/parse-results/${result.id}`);
    } catch (err) {
      try {
        const asset = await getAsset(req.params.id);
        if (!asset) {
          res.status(404).send(renderAssetsUnavailablePage({ message: 'Source asset not found.' }));
          return;
        }
        const parsers = listParsersForAsset(asset);
        const parseResults = await listParseResultsForAsset(asset.id);
        const pipelineRuns = await listPipelineRunsForAsset(asset.id);
        res.status(400).send(renderAssetDetailPage({
          asset,
          parsers,
          parseResults,
          pipelineRuns,
          error: parseResultErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderAssetsUnavailablePage({ message: parseResultErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/assets/:id/pipeline', express.urlencoded({ extended: false, limit: '50kb' }), async (req, res) => {
    const values = req.body || {};
    try {
      const result = await runManualEvidencePipeline({
        root,
        assetId: req.params.id,
        parserKey: values.parser_key,
        entityType: values.entity_type,
        entityKey: values.entity_key || '',
        candidateIndex: values.candidate_index ?? null,
        hints: {
          university: values.university,
          regulation: values.regulation,
          branch: values.branch,
          year: values.year,
          semester: values.semester,
        },
        createProposal: values.create_proposal,
        actor: config.email,
      });
      res.redirect(`/admin/pipeline-runs/${result.id}`);
    } catch (err) {
      try {
        const asset = await getAsset(req.params.id);
        if (!asset) {
          res.status(404).send(renderAssetsUnavailablePage({ message: 'Source asset not found.' }));
          return;
        }
        const parsers = listParsersForAsset(asset);
        const parseResults = await listParseResultsForAsset(asset.id);
        const pipelineRuns = await listPipelineRunsForAsset(asset.id);
        res.status(400).send(renderAssetDetailPage({
          asset,
          parsers,
          parseResults,
          pipelineRuns,
          pipelineValues: values,
          pipelineError: pipelineErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderAssetsUnavailablePage({ message: pipelineErrorSummary(innerErr) }));
      }
    }
  });

  router.get('/pipeline-runs', async (req, res) => {
    try {
      const results = await listPipelineRuns();
      res.send(renderPipelineRunsPage({ results }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: pipelineErrorSummary(err) }));
    }
  });

  router.get('/pipeline-runs/:id', async (req, res) => {
    try {
      const result = await getPipelineRun(req.params.id);
      if (!result) {
        res.status(404).send(renderAssetsUnavailablePage({ message: 'Pipeline run not found.' }));
        return;
      }
      res.send(renderPipelineRunDetailPage({ result }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: pipelineErrorSummary(err) }));
    }
  });

  router.get('/parse-results', async (req, res) => {
    try {
      const results = await listParseResults();
      res.send(renderParseResultsPage({ results }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: parseResultErrorSummary(err) }));
    }
  });

  router.get('/parse-results/:id', async (req, res) => {
    try {
      const result = await getParseResult(req.params.id);
      if (!result) {
        res.status(404).send(renderAssetsUnavailablePage({ message: 'Parse result not found.' }));
        return;
      }
      const diffResults = await listDiffResultsForParseResult(result.id);
      const extractionResults = await listExtractionResultsForParseResult(result.id);
      res.send(renderParseResultDetailPage({ result, diffResults, extractionResults }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: parseResultErrorSummary(err) }));
    }
  });

  router.post('/parse-results/:id/extract', express.urlencoded({ extended: false }), async (req, res) => {
    const values = req.body || {};
    try {
      const result = await runEntityExtraction({
        root,
        parseResultId: req.params.id,
        entityType: values.entity_type,
        entityKey: values.entity_key || '',
        candidateIndex: values.candidate_index ?? null,
        hints: {
          university: values.university,
          regulation: values.regulation,
          branch: values.branch,
          year: values.year,
          semester: values.semester,
        },
        actor: config.email,
      });
      res.redirect(`/admin/extraction-results/${result.id}`);
    } catch (err) {
      try {
        const result = await getParseResult(req.params.id);
        if (!result) {
          res.status(404).send(renderAssetsUnavailablePage({ message: 'Parse result not found.' }));
          return;
        }
        const diffResults = await listDiffResultsForParseResult(result.id);
        const extractionResults = await listExtractionResultsForParseResult(result.id);
        res.status(400).send(renderParseResultDetailPage({
          result,
          diffResults,
          extractionResults,
          extractionValues: values,
          extractionError: extractionResultErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderAssetsUnavailablePage({ message: extractionResultErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/parse-results/:id/diff', express.urlencoded({ extended: false }), async (req, res) => {
    const values = req.body || {};
    try {
      const result = await createDiffFromParseResult({
        root,
        parseResultId: req.params.id,
        entityType: values.entity_type,
        entityKey: values.entity_key,
        actor: config.email,
      });
      res.redirect(`/admin/diff-results/${result.id}`);
    } catch (err) {
      try {
        const result = await getParseResult(req.params.id);
        if (!result) {
          res.status(404).send(renderAssetsUnavailablePage({ message: 'Parse result not found.' }));
          return;
        }
        const diffResults = await listDiffResultsForParseResult(result.id);
        const extractionResults = await listExtractionResultsForParseResult(result.id);
        res.status(400).send(renderParseResultDetailPage({
          result,
          diffResults,
          extractionResults,
          values,
          error: diffResultErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderAssetsUnavailablePage({ message: diffResultErrorSummary(innerErr) }));
      }
    }
  });

  router.get('/diff-results', async (req, res) => {
    try {
      const results = await listDiffResults();
      res.send(renderDiffResultsPage({ results }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: diffResultErrorSummary(err) }));
    }
  });

  router.get('/diff-results/:id', async (req, res) => {
    try {
      const result = await getDiffResult(req.params.id);
      if (!result) {
        res.status(404).send(renderAssetsUnavailablePage({ message: 'Diff result not found.' }));
        return;
      }
      const existingProposal = await getContentProposalByDiffResult(result.id);
      res.send(renderDiffResultDetailPage({ result, existingProposal }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: diffResultErrorSummary(err) }));
    }
  });

  router.get('/extraction-results', async (req, res) => {
    try {
      const results = await listExtractionResults();
      res.send(renderExtractionResultsPage({ results }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: extractionResultErrorSummary(err) }));
    }
  });

  router.get('/extraction-results/:id', async (req, res) => {
    try {
      const result = await getExtractionResult(req.params.id);
      if (!result) {
        res.status(404).send(renderAssetsUnavailablePage({ message: 'Extraction result not found.' }));
        return;
      }
      res.send(renderExtractionResultDetailPage({ result }));
    } catch (err) {
      res.status(503).send(renderAssetsUnavailablePage({ message: extractionResultErrorSummary(err) }));
    }
  });

  router.post('/extraction-results/:id/diff', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const result = await createDiffFromExtractionResult({
        root,
        extractionResultId: req.params.id,
        actor: config.email,
      });
      res.redirect(`/admin/diff-results/${result.id}`);
    } catch (err) {
      try {
        const result = await getExtractionResult(req.params.id);
        if (!result) {
          res.status(404).send(renderAssetsUnavailablePage({ message: 'Extraction result not found.' }));
          return;
        }
        res.status(400).send(renderExtractionResultDetailPage({
          result,
          error: diffResultErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderAssetsUnavailablePage({ message: diffResultErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/diff-results/:id/proposal', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const outcome = await createContentProposalFromDiffResult({
        root,
        diffResultId: req.params.id,
        actor: config.email,
        note: req.body?.note || '',
      });
      res.redirect(`/admin/proposals/${outcome.id}`);
    } catch (err) {
      try {
        const result = await getDiffResult(req.params.id);
        if (!result) {
          res.status(404).send(renderAssetsUnavailablePage({ message: 'Diff result not found.' }));
          return;
        }
        const existingProposal = await getContentProposalByDiffResult(result.id);
        res.status(400).send(renderDiffResultDetailPage({
          result,
          existingProposal,
          error: proposalErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderProposalUnavailablePage({ message: proposalErrorSummary(innerErr) }));
      }
    }
  });

  router.get('/source-evidence', async (req, res, next) => {
    try {
      const content = await getContent(root);
      res.send(renderSourceEvidencePage({ sources: collectSources(content), contentSource: content.source }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/sources/new', (req, res) => {
    res.send(renderSourceFormPage(sourceFormOptions()));
  });

  router.post('/sources/new', express.urlencoded({ extended: false, limit: '50kb' }), async (req, res) => {
    const values = req.body || {};
    try {
      const id = await createDiscoverySource({
        input: values,
        actor: config.email,
      });
      res.redirect(`/admin/sources/${id}`);
    } catch (err) {
      res.status(400).send(renderSourceFormPage({
        ...sourceFormOptions(),
        values,
        error: discoverySourceErrorSummary(err),
      }));
    }
  });

  router.get('/sources/:id', async (req, res) => {
    try {
      const source = await getDiscoverySource(req.params.id);
      if (!source) {
        res.status(404).send(renderSourceUnavailablePage({ message: 'Discovery source not found.' }));
        return;
      }
      res.send(renderSourceDetailPage({ source }));
    } catch (err) {
      res.status(503).send(renderSourceUnavailablePage({ message: discoverySourceErrorSummary(err) }));
    }
  });

  router.get('/sources/:id/edit', async (req, res) => {
    try {
      const source = await getDiscoverySource(req.params.id);
      if (!source) {
        res.status(404).send(renderSourceUnavailablePage({ message: 'Discovery source not found.' }));
        return;
      }
      res.send(renderSourceFormPage({
        ...sourceFormOptions(),
        mode: 'edit',
        source,
        values: sourceFormValues(source),
      }));
    } catch (err) {
      res.status(503).send(renderSourceUnavailablePage({ message: discoverySourceErrorSummary(err) }));
    }
  });

  router.post('/sources/:id/edit', express.urlencoded({ extended: false, limit: '50kb' }), async (req, res) => {
    const values = req.body || {};
    try {
      await updateDiscoverySource({
        id: req.params.id,
        input: values,
        actor: config.email,
      });
      res.redirect(`/admin/sources/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const source = await getDiscoverySource(req.params.id);
        res.status(400).send(renderSourceFormPage({
          ...sourceFormOptions(),
          mode: 'edit',
          source,
          values,
          error: discoverySourceErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderSourceUnavailablePage({ message: discoverySourceErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/sources/:id/enabled', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await setDiscoverySourceEnabled({
        id: req.params.id,
        enabled: req.body?.enabled,
        note: req.body?.note || '',
        actor: config.email,
      });
      res.redirect(`/admin/sources/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const source = await getDiscoverySource(req.params.id);
        if (!source) {
          res.status(404).send(renderSourceUnavailablePage({ message: 'Discovery source not found.' }));
          return;
        }
        res.status(400).send(renderSourceDetailPage({ source, error: discoverySourceErrorSummary(err) }));
      } catch (innerErr) {
        res.status(503).send(renderSourceUnavailablePage({ message: discoverySourceErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/sources/:id/fetch', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    const values = req.body || {};
    try {
      const result = await fetchSourceUrl({
        root,
        discoverySourceId: req.params.id,
        sourceUrl: values.source_url,
        actor: config.email,
      });
      res.redirect(`/admin/assets/${result.assetId}`);
    } catch (err) {
      try {
        const source = await getDiscoverySource(req.params.id);
        if (!source) {
          res.status(404).send(renderSourceUnavailablePage({ message: 'Discovery source not found.' }));
          return;
        }
        res.status(400).send(renderSourceDetailPage({
          source,
          fetchValues: values,
          fetchError: sourceFetchErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderSourceUnavailablePage({ message: sourceFetchErrorSummary(innerErr) }));
      }
    }
  });

  router.get('/review', (req, res) => {
    res.redirect('/admin/proposals');
  });

  router.get('/review/:id', (req, res) => {
    res.redirect(`/admin/proposals/${encodeURIComponent(req.params.id)}`);
  });

  router.get('/proposals', async (req, res) => {
    try {
      const proposals = await listContentProposals();
      res.send(renderProposalsPage({ proposals }));
    } catch (err) {
      res.status(503).send(renderProposalUnavailablePage({ message: proposalErrorSummary(err) }));
    }
  });

  router.get('/proposals/new', (req, res) => {
    res.send(renderProposalCreatePage());
  });

  router.post('/proposals/new', express.urlencoded({ extended: false, limit: '200kb' }), async (req, res) => {
    const values = req.body || {};
    try {
      let proposedPayload;
      try {
        proposedPayload = JSON.parse(values.proposed_payload_json || '');
      } catch {
        throw new Error('Proposed payload must be valid JSON.');
      }

      const id = await createContentProposal({
        root,
        entityType: values.entity_type,
        entityKey: values.entity_key,
        proposedPayload,
        sourceId: parseSourceId(values.source_id),
        createdBy: config.email,
        note: values.note || '',
      });
      res.redirect(`/admin/proposals/${id}`);
    } catch (err) {
      res.status(400).send(renderProposalCreatePage({
        values,
        error: proposalErrorSummary(err),
      }));
    }
  });

  router.get('/proposals/:id', async (req, res) => {
    try {
      const proposal = await getContentProposal(req.params.id);
      if (!proposal) {
        res.status(404).send(renderProposalUnavailablePage({ message: 'Content proposal not found.' }));
        return;
      }
      const exports = await listProposalExports(proposal.id);
      res.send(renderProposalDetailPage({ proposal, exports }));
    } catch (err) {
      res.status(503).send(renderProposalUnavailablePage({ message: proposalErrorSummary(err) }));
    }
  });

  router.get('/release-candidates', async (req, res) => {
    try {
      const releases = await listReleaseCandidates();
      res.send(renderReleaseCandidatesPage({ releases }));
    } catch (err) {
      res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseCandidateErrorSummary(err) }));
    }
  });

  router.get('/release-candidates/new', (req, res) => {
    res.send(renderReleaseCandidateCreatePage());
  });

  router.post('/release-candidates/new', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    const values = req.body || {};
    try {
      const id = await createReleaseCandidate({
        title: values.title,
        actor: config.email,
      });
      res.redirect(`/admin/release-candidates/${id}`);
    } catch (err) {
      res.status(400).send(renderReleaseCandidateCreatePage({
        values,
        error: releaseCandidateErrorSummary(err),
      }));
    }
  });

  router.get('/release-candidates/:id', async (req, res) => {
    try {
      const release = await getReleaseCandidate(req.params.id);
      if (!release) {
        res.status(404).send(renderReleaseCandidateUnavailablePage({ message: 'Release candidate not found.' }));
        return;
      }
      const approvedProposals = release.status === 'draft'
        ? await listApprovedProposalsForRelease({ releaseCandidateId: release.id })
        : [];
      const reviewSummary = await generateReleaseReviewSummary({ releaseCandidateId: release.id });
      res.send(renderReleaseCandidateDetailPage({ release, approvedProposals, reviewSummary }));
    } catch (err) {
      res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseCandidateErrorSummary(err) }));
    }
  });

  router.post('/release-candidates/:id/apply-plan', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await generateReleaseApplyPlan({
        root,
        releaseCandidateId: req.params.id,
        actor: config.email,
      });
      res.redirect(`/admin/release-apply-plans/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const release = await getReleaseCandidate(req.params.id);
        const approvedProposals = release?.status === 'draft'
          ? await listApprovedProposalsForRelease({ releaseCandidateId: release.id })
          : [];
        const reviewSummary = release
          ? await generateReleaseReviewSummary({ releaseCandidateId: release.id })
          : null;
        res.status(400).send(renderReleaseCandidateDetailPage({
          release,
          approvedProposals,
          reviewSummary,
          error: releaseApplyPlanErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseApplyPlanErrorSummary(innerErr) }));
      }
    }
  });

  router.get('/release-apply-plans/:id', async (req, res) => {
    try {
      const plan = await getReleaseApplyPlan({ root, releaseCandidateId: req.params.id });
      if (!plan) {
        res.status(404).send(renderReleaseCandidateUnavailablePage({ message: 'Release apply plan not found. Generate it from a ready_for_review release candidate.' }));
        return;
      }
      const latestApply = await getLatestReleaseLiveApply(req.params.id);
      res.send(renderReleaseApplyPlanDetailPage({
        plan,
        latestApply,
        confirmationPhrase: LIVE_APPLY_CONFIRMATION,
      }));
    } catch (err) {
      res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseApplyPlanErrorSummary(err) }));
    }
  });

  router.post('/release-apply-plans/:id/apply-live', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    try {
      const result = await applyReleaseToLiveJson({
        root,
        releaseCandidateId: req.params.id,
        confirmationPhrase: req.body?.confirmation_phrase,
        reviewerNote: req.body?.reviewer_note,
        actor: config.email,
      });
      res.redirect(`/admin/release-live-applies/${result.id}`);
    } catch (err) {
      try {
        const plan = await getReleaseApplyPlan({ root, releaseCandidateId: req.params.id });
        const latestApply = await getLatestReleaseLiveApply(req.params.id);
        res.status(400).send(renderReleaseApplyPlanDetailPage({
          plan,
          latestApply,
          confirmationPhrase: LIVE_APPLY_CONFIRMATION,
          error: releaseLiveApplyErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseLiveApplyErrorSummary(innerErr) }));
      }
    }
  });

  router.get('/release-live-applies/:id', async (req, res) => {
    try {
      const result = await getReleaseLiveApply(req.params.id);
      if (!result) {
        res.status(404).send(renderReleaseCandidateUnavailablePage({ message: 'Release live apply result not found.' }));
        return;
      }
      res.send(renderReleaseLiveApplyDetailPage({
        result,
        rollbackPhrase: LIVE_ROLLBACK_CONFIRMATION,
      }));
    } catch (err) {
      res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseLiveApplyErrorSummary(err) }));
    }
  });

  router.post('/release-live-applies/:id/rollback', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    try {
      const result = await rollbackReleaseLiveApply({
        root,
        applyId: req.params.id,
        confirmationPhrase: req.body?.confirmation_phrase,
        reviewerNote: req.body?.reviewer_note,
        actor: config.email,
      });
      res.redirect(`/admin/release-live-applies/${result.id}`);
    } catch (err) {
      try {
        const result = await getReleaseLiveApply(req.params.id);
        res.status(400).send(renderReleaseLiveApplyDetailPage({
          result,
          rollbackPhrase: LIVE_ROLLBACK_CONFIRMATION,
          error: releaseLiveApplyErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseLiveApplyErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/release-candidates/:id/review-summary', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await generateReleaseReviewSummary({
        releaseCandidateId: req.params.id,
        actor: config.email,
        auditEvents: true,
      });
      res.redirect(`/admin/release-candidates/${encodeURIComponent(req.params.id)}#review-summary`);
    } catch (err) {
      try {
        const release = await getReleaseCandidate(req.params.id);
        const approvedProposals = release?.status === 'draft'
          ? await listApprovedProposalsForRelease({ releaseCandidateId: release.id })
          : [];
        res.status(400).send(renderReleaseCandidateDetailPage({
          release,
          approvedProposals,
          error: releaseReviewErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseReviewErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/release-candidates/:id/items', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await addProposalToReleaseCandidate({
        releaseCandidateId: req.params.id,
        proposalId: req.body?.proposal_id,
        actor: config.email,
      });
      res.redirect(`/admin/release-candidates/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const release = await getReleaseCandidate(req.params.id);
        const approvedProposals = release?.status === 'draft'
          ? await listApprovedProposalsForRelease({ releaseCandidateId: release.id })
          : [];
        const reviewSummary = release
          ? await generateReleaseReviewSummary({ releaseCandidateId: release.id })
          : null;
        res.status(400).send(renderReleaseCandidateDetailPage({
          release,
          approvedProposals,
          reviewSummary,
          error: releaseCandidateErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseCandidateErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/release-candidates/:id/items/:itemId/remove', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await removeProposalFromReleaseCandidate({
        releaseCandidateId: req.params.id,
        itemId: req.params.itemId,
        actor: config.email,
      });
      res.redirect(`/admin/release-candidates/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      res.status(400).send(renderReleaseCandidateUnavailablePage({ message: releaseCandidateErrorSummary(err) }));
    }
  });

  router.post('/release-candidates/:id/ready', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await markReleaseCandidateReady({
        releaseCandidateId: req.params.id,
        actor: config.email,
      });
      res.redirect(`/admin/release-candidates/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const release = await getReleaseCandidate(req.params.id);
        const approvedProposals = release?.status === 'draft'
          ? await listApprovedProposalsForRelease({ releaseCandidateId: release.id })
          : [];
        const reviewSummary = release
          ? await generateReleaseReviewSummary({ releaseCandidateId: release.id })
          : null;
        res.status(400).send(renderReleaseCandidateDetailPage({
          release,
          approvedProposals,
          reviewSummary,
          error: releaseCandidateErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseCandidateErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/release-candidates/:id/items/:itemId/export', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await exportReleaseCandidateItem({
        root,
        releaseCandidateId: req.params.id,
        itemId: req.params.itemId,
        actor: config.email,
      });
      res.redirect(`/admin/release-candidates/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const release = await getReleaseCandidate(req.params.id);
        const approvedProposals = release?.status === 'draft'
          ? await listApprovedProposalsForRelease({ releaseCandidateId: release.id })
          : [];
        const reviewSummary = release
          ? await generateReleaseReviewSummary({ releaseCandidateId: release.id })
          : null;
        res.status(400).send(renderReleaseCandidateDetailPage({
          release,
          approvedProposals,
          reviewSummary,
          error: releaseCandidateErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseCandidateErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/release-candidates/:id/items/:itemId/apply-draft', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await applyReleaseCandidateItemDraft({
        root,
        releaseCandidateId: req.params.id,
        itemId: req.params.itemId,
        actor: config.email,
      });
      res.redirect(`/admin/release-candidates/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const release = await getReleaseCandidate(req.params.id);
        const approvedProposals = release?.status === 'draft'
          ? await listApprovedProposalsForRelease({ releaseCandidateId: release.id })
          : [];
        const reviewSummary = release
          ? await generateReleaseReviewSummary({ releaseCandidateId: release.id })
          : null;
        res.status(400).send(renderReleaseCandidateDetailPage({
          release,
          approvedProposals,
          reviewSummary,
          error: releaseCandidateErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderReleaseCandidateUnavailablePage({ message: releaseCandidateErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/proposals/:id/review', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await reviewContentProposal({
        id: req.params.id,
        action: req.body?.action,
        note: req.body?.note || '',
        actor: config.email,
      });
      res.redirect(`/admin/proposals/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const proposal = await getContentProposal(req.params.id);
        if (!proposal) {
          res.status(404).send(renderProposalUnavailablePage({ message: 'Content proposal not found.' }));
          return;
        }
        const exports = await listProposalExports(proposal.id);
        res.status(400).send(renderProposalDetailPage({ proposal, exports, error: proposalErrorSummary(err) }));
      } catch (innerErr) {
        res.status(503).send(renderProposalUnavailablePage({ message: proposalErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/proposals/:id/validate', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      await validateContentProposal({
        root,
        id: req.params.id,
        actor: config.email,
      });
      res.redirect(`/admin/proposals/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      try {
        const proposal = await getContentProposal(req.params.id);
        if (!proposal) {
          res.status(404).send(renderProposalUnavailablePage({ message: 'Content proposal not found.' }));
          return;
        }
        res.status(400).send(renderProposalDetailPage({ proposal, error: proposalErrorSummary(err) }));
      } catch (innerErr) {
        res.status(503).send(renderProposalUnavailablePage({ message: proposalErrorSummary(innerErr) }));
      }
    }
  });

  router.post('/proposals/:id/export', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const result = await exportProposalForReview({
        root,
        proposalId: req.params.id,
        actor: config.email,
      });
      res.redirect(`/admin/proposal-exports/${result.id}`);
    } catch (err) {
      try {
        const proposal = await getContentProposal(req.params.id);
        if (!proposal) {
          res.status(404).send(renderProposalUnavailablePage({ message: 'Content proposal not found.' }));
          return;
        }
        const exports = await listProposalExports(proposal.id);
        res.status(400).send(renderProposalDetailPage({
          proposal,
          exports,
          error: proposalExportErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderProposalUnavailablePage({ message: proposalExportErrorSummary(innerErr) }));
      }
    }
  });

  router.get('/proposal-exports/:id', async (req, res) => {
    try {
      const result = await getProposalExport(req.params.id);
      if (!result) {
        res.status(404).send(renderProposalUnavailablePage({ message: 'Proposal export not found.' }));
        return;
      }
      const draftApplies = await listProposalDraftApplies(result.id);
      res.send(renderProposalExportDetailPage({ result, draftApplies }));
    } catch (err) {
      res.status(503).send(renderProposalUnavailablePage({ message: proposalExportErrorSummary(err) }));
    }
  });

  router.post('/proposal-exports/:id/apply-draft', express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const result = await applyProposalExportToDraft({
        root,
        proposalExportId: req.params.id,
        actor: config.email,
      });
      res.redirect(`/admin/proposal-draft-applies/${result.id}`);
    } catch (err) {
      try {
        const result = await getProposalExport(req.params.id);
        if (!result) {
          res.status(404).send(renderProposalUnavailablePage({ message: 'Proposal export not found.' }));
          return;
        }
        const draftApplies = await listProposalDraftApplies(result.id);
        res.status(400).send(renderProposalExportDetailPage({
          result,
          draftApplies,
          error: proposalDraftApplyErrorSummary(err),
        }));
      } catch (innerErr) {
        res.status(503).send(renderProposalUnavailablePage({ message: proposalDraftApplyErrorSummary(innerErr) }));
      }
    }
  });

  router.get('/proposal-draft-applies/:id', async (req, res) => {
    try {
      const result = await getProposalDraftApply(req.params.id);
      if (!result) {
        res.status(404).send(renderProposalUnavailablePage({ message: 'Proposal draft apply not found.' }));
        return;
      }
      res.send(renderProposalDraftApplyDetailPage({ result }));
    } catch (err) {
      res.status(503).send(renderProposalUnavailablePage({ message: proposalDraftApplyErrorSummary(err) }));
    }
  });

  router.get('/revisions', async (req, res) => {
    try {
      const revisions = await listRevisionEntities();
      res.send(renderRevisionsPage({ revisions }));
    } catch (err) {
      res.status(503).send(renderProposalUnavailablePage({ message: contentRevisionErrorSummary(err) }));
    }
  });

  router.get('/revisions/compare', async (req, res) => {
    try {
      const leftId = req.query?.left;
      const rightId = req.query?.right;
      if (!leftId || !rightId) throw new Error('Both left and right revision IDs are required.');
      const comparison = await compareRevisions({ leftId, rightId, actor: config.email });
      res.send(renderRevisionComparisonPage({ comparison }));
    } catch (err) {
      res.status(400).send(renderProposalUnavailablePage({ message: contentRevisionErrorSummary(err) }));
    }
  });

  router.get('/revisions/entity/:entityType/:entityKey', async (req, res) => {
    try {
      const revisions = await listRevisions({
        entityType: req.params.entityType,
        entityKey: req.params.entityKey,
      });
      res.send(renderRevisionEntityPage({
        entityType: req.params.entityType,
        entityKey: req.params.entityKey,
        revisions,
      }));
    } catch (err) {
      res.status(503).send(renderProposalUnavailablePage({ message: contentRevisionErrorSummary(err) }));
    }
  });

  router.get('/revisions/:id', async (req, res) => {
    try {
      const revision = await getRevision(req.params.id);
      if (!revision) {
        res.status(404).send(renderProposalUnavailablePage({ message: 'Content revision not found.' }));
        return;
      }
      const revisions = await listRevisions({
        entityType: revision.entityType,
        entityKey: revision.entityKey,
      });
      res.send(renderRevisionDetailPage({ revision, revisions }));
    } catch (err) {
      res.status(503).send(renderProposalUnavailablePage({ message: contentRevisionErrorSummary(err) }));
    }
  });

  return router;
}
