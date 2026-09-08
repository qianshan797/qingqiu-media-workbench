/**
 * push-files-compat.js
 * 用途: 用 create_or_update_file 替代有服务端 bug 的 push_files
 *
 * 背景:
 *   本仓库使用的 GitHub MCP 插件中, push_files 工具存在参数校验 bug,
 *   无论传什么形式的 files 参数, 都会返回:
 *     "files parameter must be an array of objects with path and content"
 *   本脚本通过逐个调用 create_or_update_file 实现等价功能, 适用于单文件
 *   或少量文件的场景(单次 commit 一个文件)。如需真正的多文件单 commit,
 *   需等待 push_files 修复或迁移到 Git Trees API。
 *
 * 适用环境:
 *   1. Node.js:        const { pushFilesCompat } = require('./push-files-compat.js')
 *   2. 浏览器 ESM:     <script src="assets/push-files-compat.js"></script>
 *   3. TRAE Agent:    通过 run_mcp 直接调用 (见文件末尾说明)
 *
 * 依赖:
 *   外部依赖以依赖注入方式传入, 保持本模块零依赖, 易于在多种环境复用。
 */

// ============================================================
// 1. 依赖注入接口
// ============================================================

/**
 * MCP 调用适配器接口
 * @typedef {Object} McpCaller
 * @property {function(string, string, object): Promise<object>} call
 *   call(serverName, toolName, args) -> { content: [{text: string}], ... }
 */

const defaultMcpCaller = {
  call: async () => {
    throw new Error(
      '[push-files-compat] No MCP caller injected. ' +
      '在 Agent 环境中通过 run_mcp 调用, 或在 Node 中注入自定义 caller。'
    );
  },
};

// ============================================================
// 2. 核心函数
// ============================================================

/**
 * 获取指定路径文件的 blob SHA, 不存在则返回 null
 */
async function getFileSha({ owner, repo, path, ref, mcp = defaultMcpCaller }) {
  try {
    const res = await mcp.call(
      'mcp_trae-remote-official_plugin_github_github',
      'get_file_contents',
      { owner, repo, path, ref }
    );
    const text = (res && res.content && res.content[0] && res.content[0].text) || '';
    const match = text.match(/SHA:\s*([a-f0-9]{40})/);
    return match ? match[1] : null;
  } catch (e) {
    if (/does not exist|not found/i.test(String(e.message || e))) return null;
    throw e;
  }
}

/**
 * 单文件 create or update
 */
async function createOrUpdateFile({
  owner, repo, branch, message, path, content, sha = null, mcp = defaultMcpCaller,
}) {
  const args = { owner, repo, branch, message, path, content };
  if (sha) args.sha = sha;
  const res = await mcp.call(
    'mcp_trae-remote-official_plugin_github_github',
    'create_or_update_file',
    args
  );
  const text = (res && res.content && res.content[0] && res.content[0].text) || '{}';
  const parsed = JSON.parse(text);
  return {
    path: (parsed.content && parsed.content.path) || path,
    sha: parsed.content && parsed.content.sha,
    commit: parsed.commit && parsed.commit.sha,
    html_url: parsed.content && parsed.content.html_url,
  };
}

/**
 * push_files 的兼容实现
 * - 逐个文件走 get_file_contents + create_or_update_file 流程
 * - 串行提交, 每个文件一个 commit (非原子, 但功能等价于 push_files 成功后的状态)
 */
async function pushFilesCompat({
  owner, repo, branch, message, files, mcp = defaultMcpCaller, stopOnError = true,
}) {
  if (!owner || !repo || !branch || !message) {
    throw new Error('[push-files-compat] owner/repo/branch/message 都是必填');
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('[push-files-compat] files 必须是非空数组');
  }
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') {
      throw new Error('[push-files-compat] 每个 file 必须包含 path 和 content 字符串');
    }
  }

  const results = [];
  for (const file of files) {
    try {
      const sha = await getFileSha({ owner, repo, path: file.path, ref: branch, mcp });
      const out = await createOrUpdateFile({
        owner, repo, branch, message,
        path: file.path, content: file.content,
        sha, mcp,
      });
      results.push({ path: file.path, ok: true, sha: out.sha, commit: out.commit });
    } catch (e) {
      const errMsg = String((e && e.message) || e);
      results.push({ path: file.path, ok: false, error: errMsg });
      if (stopOnError) {
        return {
          success: false, total: files.length,
          succeeded: results.filter(r => r.ok).length,
          failed: results.filter(r => !r.ok).length,
          results,
        };
      }
    }
  }

  return {
    success: results.every(r => r.ok),
    total: files.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  };
}

// ============================================================
// 3. 浏览器侧 REST 直连版本
// ============================================================

/**
 * 通过 GitHub REST API 直接推送单文件(浏览器/无 MCP 环境)
 * 需要 GitHub PAT, 具备 repo 权限
 */
async function pushFileViaRest({ token, owner, repo, branch, message, path, content }) {
  if (!token) throw new Error('[push-files-compat] REST 模式需要 GitHub PAT');

  const getRes = await fetch(
    'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + encodeURIComponent(path) + '?ref=' + encodeURIComponent(branch),
    { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } }
  );
  let existingSha = null;
  if (getRes.ok) {
    const data = await getRes.json();
    existingSha = data.sha;
  } else if (getRes.status !== 404) {
    throw new Error('[push-files-compat] GET 失败 ' + getRes.status + ': ' + await getRes.text());
  }

  const putRes = await fetch(
    'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + encodeURIComponent(path),
    {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message, content, branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    }
  );
  if (!putRes.ok) {
    throw new Error('[push-files-compat] PUT 失败 ' + putRes.status + ': ' + await putRes.text());
  }
  const data = await putRes.json();
  return {
    path: data.content.path,
    sha: data.content.sha,
    commit: data.commit.sha,
    html_url: data.content.html_url,
  };
}

async function pushFilesCompatViaRest({
  token, owner, repo, branch, message, files, stopOnError = true,
}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('[push-files-compat] files 必须是非空数组');
  }
  const results = [];
  for (const file of files) {
    try {
      const out = await pushFileViaRest({ token, owner, repo, branch, message, path: file.path, content: file.content });
      results.push({ path: file.path, ok: true, sha: out.sha, commit: out.commit });
    } catch (e) {
      results.push({ path: file.path, ok: false, error: String((e && e.message) || e) });
      if (stopOnError) break;
    }
  }
  return {
    success: results.every(r => r.ok),
    total: files.length,
    succeeded: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  };
}

// ============================================================
// 4. 导出
// ============================================================

const _exports = {
  pushFilesCompat,
  pushFilesCompatViaRest,
  getFileSha,
  createOrUpdateFile,
  pushFileViaRest,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _exports;
}
if (typeof window !== 'undefined') {
  window.PushFilesCompat = _exports;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PushFilesCompat = _exports;
}

// ============================================================
// 5. TRAE Agent 内的使用示例
// ============================================================
//
// 在 TRAE 对话中, agent 拿到 run_mcp 工具, 可按以下模式调用本模块的逻辑:
//
//   const mcpCaller = {
//     call: async (server, tool, args) => tools.run_mcp({ server_name: server, tool_name: tool, args })
//   };
//   const { pushFilesCompat } = require('./push-files-compat.js');
//   const result = await pushFilesCompat({
//     owner: 'qianshan797',
//     repo: 'qingqiu-media-workbench',
//     branch: 'gh-pages',
//     message: 'auto: daily news 2026-09-08',
//     files: [{ path: 'news-data.json', content: '...JSON 字符串...' }],
//     mcp: mcpCaller,
//   });
//
// 或直接串联 run_mcp (无需 import):
//   for (const f of files) {
//     const cur = await tools.run_mcp({ server_name: '...', tool_name: 'get_file_contents', args: { owner, repo, path: f.path, ref: branch } });
//     const sha = ...;
//     await tools.run_mcp({ server_name: '...', tool_name: 'create_or_update_file', args: { owner, repo, branch, message, path: f.path, content: f.content, sha } });
//   }
