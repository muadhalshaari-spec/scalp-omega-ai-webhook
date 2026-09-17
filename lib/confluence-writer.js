const OWNER = 'muadhalshaari-spec';
const REPO = 'scalp-omega-ai-webhook';
const PATH = 'CONFLUENCE_RESULT.txt';

export async function updateConfluenceResult(payload) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { ok: false, skipped: true, reason: 'GITHUB_TOKEN is not configured' };
  }

  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(PATH)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };

  const getResponse = await fetch(apiUrl, { headers, cache: 'no-store' });
  const getText = await getResponse.text();
  let current = null;
  try { current = JSON.parse(getText); } catch {}

  if (!getResponse.ok || !current?.sha) {
    throw new Error(`GitHub file read failed: HTTP ${getResponse.status}`);
  }

  const content = JSON.stringify(payload, null, 2) + '\n';
  const encoded = Buffer.from(content, 'utf8').toString('base64');

  const putResponse = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `chore: update live CONFLUENCE_RESULT [skip ci]`,
      content: encoded,
      sha: current.sha,
      branch: 'main'
    })
  });

  const putText = await putResponse.text();
  let result = null;
  try { result = JSON.parse(putText); } catch {}

  if (!putResponse.ok || !result?.content?.sha) {
    throw new Error(`GitHub file update failed: HTTP ${putResponse.status}`);
  }

  return {
    ok: true,
    path: PATH,
    commitSha: result.commit?.sha || null,
    contentSha: result.content.sha
  };
}
