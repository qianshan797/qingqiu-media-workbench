/**
 * daily-news-push.js
 * 用途: 每日快讯自动化推送流程的完整实现
 *
 * 依赖: push-files-compat.js (同级目录)
 * 输入: 今日新闻 JSON 数组
 * 输出: GitHub 推送结果
 *
 * 使用方法 (TRAE Agent 中):
 *   1. 用 WebSearch 收集新闻(本文件不集成, 由 agent 完成)
 *   2. 构造 JSON 数组
 *   3. 调用本文件的 pushDailyNews(jsonArray, { mcp })
 */

const { pushFilesCompat } = require('./push-files-compat.js');

const DEFAULT_CONFIG = {
  owner: 'qianshan797',
  repo: 'qingqiu-media-workbench',
  branch: 'gh-pages',
  newsFilePath: 'news-data.json',
};

/** 校验单条新闻是否符合 schema */
function validateNewsItem(item, idx) {
  const required = ['id', 'date', 'category', 'title', 'summary', 'source', 'tags', 'read', 'createdAt'];
  for (const k of required) {
    if (!(k in item)) throw new Error('第 ' + (idx + 1) + ' 条新闻缺少字段: ' + k);
  }
  if (typeof item.title !== 'string' || item.title.length === 0) {
    throw new Error('第 ' + (idx + 1) + ' 条新闻 title 无效');
  }
  if (typeof item.summary !== 'string' || item.summary.length < 30 || item.summary.length > 200) {
    throw new Error('第 ' + (idx + 1) + ' 条新闻 summary 长度需在 30-200 字之间');
  }
  if (!Array.isArray(item.tags) || item.tags.length < 1) {
    throw new Error('第 ' + (idx + 1) + ' 条新闻 tags 必须是非空数组');
  }
  if (typeof item.source !== 'string' || !/^https?:\/\//.test(item.source)) {
    throw new Error('第 ' + (idx + 1) + ' 条新闻 source 必须是 http(s) URL');
  }
}

function validateNewsArray(arr) {
  if (!Array.isArray(arr)) throw new Error('news 必须是 JSON 数组');
  if (arr.length === 0) throw new Error('news 数组不能为空');
  arr.forEach((item, i) => validateNewsItem(item, i));
  return true;
}

/**
 * 推送每日快讯到工作台仓库
 */
async function pushDailyNews(newsArray, options = {}) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, options);
  if (!cfg.mcp) throw new Error('pushDailyNews: 必须注入 mcp caller');

  validateNewsArray(newsArray);
  const today = newsArray[0].date;
  const todayCompact = today.replace(/-/g, '');

  const content = JSON.stringify(newsArray, null, 0);
  const message = 'auto: daily news ' + today;

  if (cfg.dryRun) {
    return {
      success: true,
      dryRun: true,
      fileCount: 1,
      totalBytes: content.length,
      message,
      preview: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
    };
  }

  const result = await pushFilesCompat({
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    message,
    files: [{ path: cfg.newsFilePath, content }],
    mcp: cfg.mcp,
    stopOnError: true,
  });

  return {
    success: result.success,
    fileCount: 1,
    bytes: content.length,
    message,
    newsCount: newsArray.length,
    date: today,
    dateCompact: todayCompact,
    fileSha: result.results[0] && result.results[0].sha,
    commitSha: result.results[0] && result.results[0].commit,
    htmlUrl: 'https://github.com/' + cfg.owner + '/' + cfg.repo + '/blob/' + cfg.branch + '/' + cfg.newsFilePath,
    raw: result,
  };
}

module.exports = {
  pushDailyNews,
  validateNewsArray,
  validateNewsItem,
  DEFAULT_CONFIG,
};

// ============================================================
// TRAE Agent 使用模板
// ============================================================
//
// 1. 构造 mcpCaller:
//    const mcpCaller = {
//      call: async (server, tool, args) => tools.run_mcp({
//        server_name: server,
//        tool_name: tool,
//        args
//      })
//    };
//
// 2. 准备新闻数组(示例):
//    const news = [
//      {
//        id: 'news_20260908_001',
//        date: '2026-09-08',
//        category: '贸易政策',
//        title: '...',
//        summary: '...',
//        source: 'https://...',
//        tags: ['...', '...'],
//        read: false,
//        createdAt: Date.now(),
//      },
//    ];
//
// 3. 推送:
//    const result = await pushDailyNews(news, { mcp: mcpCaller });
//    console.log(result);
