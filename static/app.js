'use strict';

(() => {
  // -------------------------------------------------------------------------
  // DOM 引用
  // -------------------------------------------------------------------------
  const platformSelect = document.getElementById('platform');
  const handleInput = document.getElementById('handle');
  const platformHint = document.getElementById('platform-hint');
  const categorySelect = document.getElementById('category');
  const categoryStatus = document.getElementById('category-status');
  const categoryStatusText = document.getElementById('category-status-text');
  const retryBtn = document.getElementById('retry-btn');
  const form = document.getElementById('subscription-form');
  const submitBtn = document.getElementById('submit-btn');
  const formMessage = document.getElementById('form-message');
  const resultsSection = document.getElementById('results');
  const resultsSummary = document.getElementById('results-summary');
  const resultsList = document.getElementById('results-list');

  const PLATFORM_PLACEHOLDERS = {
    youtube: '@quietcassASMR',
    bilibili: '输入用户 UID',
    xiaohongshu: '用户 ID（主页链接中的 24 位 ID）',
    reddit: '用户名（如 quietcass）',
    twitter: '用户名（不带 @）',
    instagram: '用户名（不带 @）',
    telegram: '频道名（不带 @）',
    custom: '粘贴 RSS 订阅源 URL（如 https://news.ycombinator.com/rss）',
    zhihu_hot: '无需填写',
    zhihu_daily: '无需填写',
    weibo_hot: '无需填写',
    weibo_user: '数字 uid（博主主页控制台 $CONFIG.oid）',
    zhihu_user: '主页 URL 中的 id（如 diygod）',
    wechat: 'ershicimi 公众号 id',
  };

  // 各平台的配置提示（技术文案）；值为空字符串时不显示
  const PLATFORM_HINTS = {
    telegram: '公开频道免配置，可直接添加',
    instagram: '公开账号免配置；私密账号需 RSSHub 配置 IG_USERNAME/IG_PASSWORD',
    twitter: '需 RSSHub 配置 TWITTER_AUTH_TOKEN，且源不稳定',
    xiaohongshu: '需 RSSHub 配置 XIAOHONGSHU_COOKIE（建议加代理）',
    reddit: 'Reddit 可能拒绝机房 IP（403/429），失败属预期',
    youtube: '',
    bilibili: '需 RSSHub 配置 BILIBILI_COOKIE_<uid>',
    custom: '支持任意原生 RSS 源（Hacker News / V2EX / 少数派 / 36kr 等）',
    zhihu_hot: '免配置，可直接添加',
    zhihu_daily: '免配置，可直接添加',
    weibo_hot: '免配置，可直接添加',
    weibo_user: '需 RSSHub 配置 WEIBO_COOKIES',
    zhihu_user: '建议 RSSHub 配置 ZHIHU_COOKIES',
    wechat: '需先在 ershicimi.com 查公众号 id；第三方来源可能失效',
  };

  // 固定源平台：无需 handle 输入（输入框禁用，提交时 handle 传空）
  const FIXED_PLATFORMS = ['zhihu_hot', 'zhihu_daily', 'weibo_hot'];

  const SUBMIT_LABEL = '一键添加';
  const SUBMIT_BUSY_LABEL = '提交中…';

  let categoriesLoaded = false;
  let submitting = false;

  // -------------------------------------------------------------------------
  // 状态提示
  // -------------------------------------------------------------------------
  function setFormMessage(message, type) {
    if (!message) {
      formMessage.textContent = '';
      formMessage.classList.add('hidden');
      return;
    }
    formMessage.textContent = message;
    formMessage.classList.toggle('error', type === 'error');
    formMessage.classList.remove('hidden');
  }

  function updateSubmitState() {
    submitBtn.disabled = submitting || !categoriesLoaded;
    submitBtn.textContent = submitting ? SUBMIT_BUSY_LABEL : SUBMIT_LABEL;
  }

  // -------------------------------------------------------------------------
  // 分类下拉加载
  // -------------------------------------------------------------------------
  function setCategoryLoading() {
    categorySelect.disabled = true;
    categorySelect.innerHTML = '<option value="">加载中…</option>';
    categoryStatus.classList.add('hidden');
  }

  function setCategoryFailure(message) {
    categorySelect.disabled = true;
    categorySelect.innerHTML = '<option value="">分类加载失败</option>';
    // 展示后端返回的具体错误；无详情时用默认文案
    categoryStatusText.textContent = message || '分类加载失败，无法获取 FreshRSS 分类列表。';
    categoryStatus.classList.remove('hidden');
  }

  function renderCategories(categories) {
    categorySelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = categories.length ? '请选择分类' : '暂无可用分类';
    categorySelect.appendChild(placeholder);

    for (const name of categories) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      categorySelect.appendChild(option);
    }

    categorySelect.disabled = categories.length === 0;
    categoriesLoaded = true;
    updateSubmitState();
  }

  async function loadCategories() {
    setCategoryLoading();
    setFormMessage(null);

    try {
      const res = await fetch('/api/categories');
      if (!res.ok) {
        // 优先透出后端返回的 error 详情，方便定位问题
        let detail = 'HTTP ' + res.status;
        try {
          const data = await res.json();
          if (data && data.error) {
            detail = data.error;
          }
        } catch (_) {
          // 响应体不是 JSON 时保留状态码信息
        }
        throw new Error(detail);
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.categories)) {
        throw new Error('响应格式不正确');
      }
      renderCategories(data.categories);
    } catch (err) {
      const genericNetwork = '网络错误，无法连接服务。';
      const msg =
        err && err.message && !err.message.includes('Failed to fetch')
          ? err.message
          : genericNetwork;
      setCategoryFailure(msg);
      updateSubmitState();
    }
  }

  retryBtn.addEventListener('click', loadCategories);

  // -------------------------------------------------------------------------
  // 平台切换：更新 handle placeholder、禁用态与配置提示
  // -------------------------------------------------------------------------
  function updatePlatformField() {
    const value = platformSelect.value;
    const isFixed = FIXED_PLATFORMS.indexOf(value) !== -1;

    handleInput.placeholder = PLATFORM_PLACEHOLDERS[value] || '';
    handleInput.disabled = isFixed;
    if (!isFixed) {
      handleInput.value = '';
    }

    const hint = PLATFORM_HINTS[value] || '';
    platformHint.textContent = hint;
    platformHint.classList.toggle('hidden', !hint);
  }

  platformSelect.addEventListener('change', updatePlatformField);
  updatePlatformField();

  // -------------------------------------------------------------------------
  // 表单提交
  // -------------------------------------------------------------------------
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (submitting || !categoriesLoaded) {
      return;
    }

    const platform = platformSelect.value;
    const isFixed = FIXED_PLATFORMS.indexOf(platform) !== -1;
    // 固定源平台无需 handle，提交空串（后端会忽略）
    const handle = isFixed ? '' : handleInput.value.trim();
    const category = categorySelect.value;

    if (!isFixed && !handle) {
      setFormMessage('请输入用户名 / Handle。', 'error');
      handleInput.focus();
      return;
    }
    if (!category) {
      setFormMessage('请选择分类。', 'error');
      categorySelect.focus();
      return;
    }

    setFormMessage(null);
    resultsSection.classList.add('hidden');
    submitting = true;
    updateSubmitState();

    try {
      const res = await fetch('/api/add-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, handle, category }),
      });

      if (res.status === 200) {
        const data = await res.json();
        if (data && data.success && Array.isArray(data.results)) {
          renderResults(data.results);
        } else {
          setFormMessage((data && data.error) || '添加失败，请稍后重试。', 'error');
        }
        return;
      }

      // 400 / 422 / 500 / 502 等：优先展示服务端返回的 error 信息
      let message = '请求失败（HTTP ' + res.status + '），请稍后重试。';
      try {
        const data = await res.json();
        if (data && data.error) {
          message = data.error;
        }
      } catch (_) {
        // 响应体不是 JSON 时保留通用提示
      }
      setFormMessage(message, 'error');
    } catch (_) {
      setFormMessage('网络错误，无法连接到服务，请检查网络后重试。', 'error');
    } finally {
      submitting = false;
      updateSubmitState();
    }
  });

  // -------------------------------------------------------------------------
  // 结果渲染
  // -------------------------------------------------------------------------
  function renderResults(results) {
    resultsList.textContent = '';
    let okCount = 0;

    for (const item of results) {
      const ok = Boolean(item.ok);
      if (ok) {
        okCount += 1;
      }

      const row = document.createElement('li');
      row.className = 'result-row ' + (ok ? 'is-success' : 'is-failure');

      const badge = document.createElement('span');
      badge.className = 'result-badge';
      badge.textContent = ok ? '成功' : '失败';

      const body = document.createElement('div');
      body.className = 'result-body';

      const url = document.createElement('div');
      url.className = 'result-url';
      url.textContent = item.url || '（无 URL）';

      const meta = document.createElement('div');
      meta.className = 'result-meta';
      const statusText = item.status != null ? 'HTTP ' + item.status : '无状态码';
      const detailText = item.detail ? ' · ' + item.detail : '';
      meta.textContent = statusText + detailText;

      body.appendChild(url);
      body.appendChild(meta);
      row.appendChild(badge);
      row.appendChild(body);
      resultsList.appendChild(row);
    }

    resultsSummary.textContent =
      '共 ' + results.length + ' 条：' + okCount + ' 条成功，' + (results.length - okCount) + ' 条失败';
    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // -------------------------------------------------------------------------
  // 初始化
  // -------------------------------------------------------------------------
  loadCategories();
})();
