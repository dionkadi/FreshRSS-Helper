'use strict';

(() => {
  // -------------------------------------------------------------------------
  // DOM 引用
  // -------------------------------------------------------------------------
  const platformSelect = document.getElementById('platform');
  const handleInput = document.getElementById('handle');
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
  };

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
  // 平台切换：更新 handle placeholder
  // -------------------------------------------------------------------------
  function updatePlaceholder() {
    handleInput.placeholder = PLATFORM_PLACEHOLDERS[platformSelect.value] || '';
  }

  platformSelect.addEventListener('change', updatePlaceholder);
  updatePlaceholder();

  // -------------------------------------------------------------------------
  // 表单提交
  // -------------------------------------------------------------------------
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (submitting || !categoriesLoaded) {
      return;
    }

    const platform = platformSelect.value;
    const handle = handleInput.value.trim();
    const category = categorySelect.value;

    if (!handle) {
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
