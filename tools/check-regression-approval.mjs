// Run only from the trusted default branch in pull_request_target. The required
// status is "Held-out regression suite unchanged", not this workflow's job name.
import { readFileSync } from 'node:fs';

const LABEL = 'regression-approved';
const APPROVAL_CONTEXT = 'regression-approval';
const GATE_CONTEXT = 'Held-out regression suite unchanged';
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const apiUrl = process.env.GITHUB_API_URL;
const runUrl = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

async function request(path, body) {
  const response = await fetch(`${apiUrl}/repos/${repository}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`GitHub ${response.status} while checking regression approval.`);
  return response.json();
}

async function list(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await request(`${path}?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('GitHub returned an invalid list.');
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

function hasLabel(pr) {
  return pr.labels.some((label) => label.name === LABEL);
}

function assertSamePullRequest(actual, expected) {
  if (
    actual.number !== expected.number ||
    actual.head.sha !== expected.head.sha ||
    actual.base.sha !== expected.base.sha ||
    actual.base.ref !== expected.base.ref ||
    hasLabel(actual) !== hasLabel(expected)
  ) {
    throw new Error(
      'The PR changed while checking. Rerun the guard for its current head and base.',
    );
  }
}

async function main() {
  if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token || !apiUrl) {
    throw new Error('GitHub repository, token, and API URL are required.');
  }
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request_target') {
    throw new Error('Regression approval must run from pull_request_target.');
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (
    !Number.isSafeInteger(pr?.number) ||
    pr.number < 1 ||
    !/^[a-f0-9]{40}$/.test(pr.head?.sha) ||
    !/^[a-f0-9]{40}$/.test(pr.base?.sha) ||
    !Array.isArray(pr.labels)
  ) {
    throw new Error('The event does not identify a valid PR head and base.');
  }
  const prPath = `pulls/${pr.number}`;
  const postStatus = (headSha, context, state, description) =>
    request(`statuses/${headSha}`, { context, state, description, target_url: runUrl });
  await postStatus(pr.head.sha, GATE_CONTEXT, 'pending', 'Checking the current PR head and base.');
  const current = await request(prPath);
  if (current.number !== pr.number) throw new Error('GitHub returned a different PR.');
  const isCurrentRevisionEvent =
    current.head.sha === pr.head.sha &&
    current.base.sha === pr.base.sha &&
    current.base.ref === pr.base.ref;
  if (current.head.sha !== pr.head.sha) {
    await postStatus(
      current.head.sha,
      GATE_CONTEXT,
      'pending',
      'Checking the current PR head and base.',
    );
  }

  // GitHub caps this endpoint at 3000 files. Incomplete metadata cannot prove
  // the suite unchanged, so large or racing comparisons fail closed.
  if (!Number.isSafeInteger(current.changed_files) || current.changed_files > 3000) {
    throw new Error('GitHub cannot provide the complete changed-file list for this PR.');
  }
  const files = await list(`${prPath}/files`);
  if (files.length !== current.changed_files)
    throw new Error('The PR changed-file list is incomplete.');
  const touched = files.some((file) => {
    if (typeof file.filename !== 'string') throw new Error('GitHub returned an invalid filename.');
    return [file.filename, file.previous_filename].some((path) =>
      path?.startsWith('sidecar/regression/'),
    );
  });

  const approvalDescription = `PR #${current.number} base ${current.base.sha}`;
  const approvalLabelEvent = event.label?.name === LABEL;
  let approved = false;
  if (
    touched &&
    approvalLabelEvent &&
    event.action === 'labeled' &&
    isCurrentRevisionEvent &&
    process.env.GITHUB_RUN_ATTEMPT === '1'
  ) {
    if (event.sender?.type === 'User') {
      const actor = encodeURIComponent(event.sender.login);
      const { permission } = await request(`collaborators/${actor}/permission`);
      approved = hasLabel(current) && ['write', 'admin'].includes(permission);
    }
    assertSamePullRequest(await request(prPath), current);
    await postStatus(
      current.head.sha,
      APPROVAL_CONTEXT,
      approved ? 'success' : 'failure',
      approvalDescription,
    );
  } else if (approvalLabelEvent && event.action === 'unlabeled' && !hasLabel(current)) {
    await postStatus(current.head.sha, APPROVAL_CONTEXT, 'failure', approvalDescription);
  } else if (touched && hasLabel(current)) {
    const statuses = await list(`commits/${current.head.sha}/statuses`);
    const approval = statuses.find((status) => status.context === APPROVAL_CONTEXT);
    approved =
      approval?.state === 'success' &&
      approval.description === approvalDescription &&
      approval.creator?.login === 'github-actions[bot]';
  }

  assertSamePullRequest(await request(prPath), current);
  const allowed = !touched || approved;
  let description = 'Review this head and base, then remove and re-add regression-approved.';
  if (!touched) description = 'The held-out regression suite is unchanged.';
  else if (approved) description = 'Regression edits approved for this PR head and base.';
  await postStatus(current.head.sha, GATE_CONTEXT, allowed ? 'success' : 'failure', description);
  console.log(description);
  if (!allowed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
