/**
 * push-files-compat.js
 * 替代 MCP push_files 的浏览器端兼容实现，直接调用 GitHub REST API。
 */
(function (global) {
    'use strict';

    async function ghApi(path, token, opts) {
        const url = 'https://api.github.com' + path;
        const res = await fetch(url, {
            ...opts,
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': 'token ' + token,
                'X-GitHub-Api-Version': '2022-11-28',
                ...(opts.headers || {})
            }
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* ignore */ }
        return { status: res.status, ok: res.ok, body: json || text };
    }

    async function pushSingleFile({ token, owner, repo, branch, message, file }) {
        const { path: fpath, content } = file;
        try {
            // 1. 尝试获取现有文件 SHA
            let sha = null;
            const getRes = await ghApi(
                `/repos/${owner}/${repo}/contents/${encodeURIComponent(fpath)}?ref=${encodeURIComponent(branch)}`,
                token,
                { method: 'GET' }
            );
            if (getRes.ok && getRes.body && getRes.body.sha) {
                sha = getRes.body.sha;
            }

            // 2. 推送文件
            const payload = {
                message: message || ('auto: update ' + fpath),
                content: btoa(unescape(encodeURIComponent(content))),
                branch: branch
            };
            if (sha) payload.sha = sha;

            const putRes = await ghApi(
                `/repos/${owner}/${repo}/contents/${encodeURIComponent(fpath)}`,
                token,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }
            );

            if (!putRes.ok) {
                const errMsg = (putRes.body && putRes.body.message) || ('HTTP ' + putRes.status);
                return { ok: false, path: fpath, error: errMsg };
            }

            const commitSha = putRes.body && putRes.body.commit && putRes.body.commit.sha;
            const fileSha = putRes.body && putRes.body.content && putRes.body.content.sha;
            return { ok: true, path: fpath, sha: fileSha, commit: commitSha };
        } catch (e) {
            return { ok: false, path: fpath, error: e && e.message ? e.message : String(e) };
        }
    }

    async function pushFilesCompatViaRest({ token, owner, repo, branch, message, files }) {
        if (!Array.isArray(files)) {
            return { success: false, results: [{ ok: false, path: '', error: 'files must be an array' }] };
        }
        const results = [];
        for (const file of files) {
            const r = await pushSingleFile({ token, owner, repo, branch, message, file });
            results.push(r);
        }
        const allOk = results.every(r => r.ok);
        return { success: allOk, results };
    }

    global.PushFilesCompat = { pushFilesCompatViaRest };
})(typeof window !== 'undefined' ? window : global);
