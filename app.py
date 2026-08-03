# -*- coding: utf-8 -*-
"""
自定义订阅助手 (Subscription Helper) —— Flask 后端网关

职责：
1. 提供健康检查与分类列表 API（对接 FreshRSS 的 Google Reader API / greader）。
2. 接收前端表单提交的 平台 / handle / 分类，解析出 RSS 链接（YouTube 视频 RSS + RSSHub 社区动态 RSS）。
3. 通过 FreshRSS greader 的 subscription/edit 接口把两条链接推送到指定分类。

说明：
- FRESHRSS_API_PASSWORD 是 FreshRSS 用户设置里单独设置的『API 密码』，不是登录密码。
- 所有出站请求均使用 requests，依赖仅 flask + requests + 标准库。
"""

import base64
import logging
import os
import re

import requests
from flask import Flask, jsonify, render_template, request

# ---------------------------------------------------------------------------
# 日志配置：输出到 stdout，方便 Docker 收集
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("subscription-helper")

# ---------------------------------------------------------------------------
# 配置：全部从环境变量读取（import 阶段不发起任何网络请求）
# ---------------------------------------------------------------------------
FRESHRSS_BASE_URL = os.environ.get("FRESHRSS_BASE_URL", "http://localhost").rstrip("/")
FRESHRSS_USER = os.environ.get("FRESHRSS_USER", "")
# 注意：这是 FreshRSS 中的 API 密码（API password），与登录密码是两回事
FRESHRSS_API_PASSWORD = os.environ.get("FRESHRSS_API_PASSWORD", "")
RSSHUB_BASE_URL = os.environ.get("RSSHUB_BASE_URL", "http://rsshub:1200").rstrip("/")
PORT = int(os.environ.get("PORT", "8081"))

# FreshRSS 内置的 Google Reader API (greader) 端点
GREADER_BASE = FRESHRSS_BASE_URL + "/api/greader.php/reader/api/0"
SUBSCRIPTION_LIST_URL = GREADER_BASE + "/subscription/list"   # 拉取订阅列表（用于收集分类）
SUBSCRIPTION_EDIT_URL = GREADER_BASE + "/subscription/edit"   # 添加/修改订阅

# 浏览器 UA：greader 接口与 YouTube 均需伪装成浏览器访问
CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _mask(value):
    """密码打码，仅用于日志输出。"""
    if not value:
        return ""
    if len(value) <= 4:
        return "*" * len(value)
    return value[:2] + "*" * (len(value) - 4) + value[-2:]


def _basic_auth_header():
    """生成 UTF-8 安全的 Basic Auth 头。

    requests 自带的 auth=(user, password) 会把凭据按 latin-1 编码，
    当 FreshRSS 用户名含中文等非 ASCII 字符时会抛 UnicodeEncodeError
    （requests/auth.py: _basic_auth_str -> username.encode("latin1")）。
    这里手工按 UTF-8 编码构造 Authorization 头（RFC 7617），
    ASCII 凭据下行为与原来完全一致。
    """
    raw = "{}:{}".format(FRESHRSS_USER, FRESHRSS_API_PASSWORD).encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


# 启动日志：打印配置摘要（密码打码）
logger.info(
    "订阅助手启动，配置摘要: FRESHRSS_BASE_URL=%s FRESHRSS_USER=%s "
    "FRESHRSS_API_PASSWORD=%s RSSHUB_BASE_URL=%s PORT=%s",
    FRESHRSS_BASE_URL,
    FRESHRSS_USER,
    _mask(FRESHRSS_API_PASSWORD),
    RSSHUB_BASE_URL,
    PORT,
)
logger.info(
    "FreshRSS greader 端点: subscription/list=%s subscription/edit=%s",
    SUBSCRIPTION_LIST_URL,
    SUBSCRIPTION_EDIT_URL,
)

app = Flask(__name__)


class SubscriptionError(Exception):
    """业务层面的可预期错误，携带返回给前端的 HTTP 状态码。"""

    def __init__(self, message, status_code):
        super().__init__(message)
        self.status_code = status_code


# ---------------------------------------------------------------------------
# 请求日志：记录每个请求的方法 / 路径 / 结果状态
# ---------------------------------------------------------------------------
@app.after_request
def log_request(response):
    logger.info("请求 %s %s -> HTTP %s", request.method, request.path, response.status_code)
    return response


# ---------------------------------------------------------------------------
# 路由 1：首页（前端表单页面由另一条线并行开发，模板最终会存在）
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# 路由 2：健康检查
# ---------------------------------------------------------------------------
@app.route("/api/health")
def api_health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# 路由 3：拉取 FreshRSS 现有分类列表
# 调用 greader subscription/list 接口，收集所有订阅条目上出现过的去重分类 label
# ---------------------------------------------------------------------------
@app.route("/api/categories")
def api_categories():
    try:
        resp = requests.get(
            SUBSCRIPTION_LIST_URL,
            timeout=15,
            headers={"User-Agent": CHROME_UA, "Authorization": _basic_auth_header()},
        )
        if resp.status_code != 200:
            msg = "FreshRSS 订阅列表接口返回 HTTP %s: %s" % (resp.status_code, resp.text[:200])
            logger.warning("获取分类失败: %s", msg)
            return jsonify({"error": msg}), 502
        data = resp.json()
    except ValueError:
        logger.exception("FreshRSS 订阅列表响应不是合法 JSON")
        return jsonify({"error": "FreshRSS 返回了非 JSON 响应，请检查 API 是否开启"}), 502
    except Exception:
        logger.exception("拉取 FreshRSS 订阅列表时发生异常")
        return jsonify({"error": "无法连接 FreshRSS 或认证失败，请检查 FRESHRSS_BASE_URL / FRESHRSS_USER / FRESHRSS_API_PASSWORD"}), 502

    # 遍历所有订阅，收集 categories 数组里的 label 并去重
    categories = set()
    for sub in data.get("subscriptions", []) or []:
        for cat in sub.get("categories", []) or []:
            label = cat.get("label")
            if label:
                categories.add(label)

    result = sorted(categories)
    logger.info("获取到分类列表（共 %d 个）: %s", len(result), result)
    return jsonify({"categories": result})


# ---------------------------------------------------------------------------
# YouTube 解析：handle -> Channel ID，再拼装两条 RSS 链接
# ---------------------------------------------------------------------------
def _resolve_youtube(handle):
    """请求 YouTube 频道页，按优先级用三种正则提取 Channel ID。"""
    # 去掉开头的 @ 并清理空白字符
    handle = handle.lstrip("@").strip()
    url = "https://www.youtube.com/@" + handle
    logger.info("请求 YouTube 频道页以解析 Channel ID: %s", url)

    try:
        resp = requests.get(url, headers={"User-Agent": CHROME_UA}, timeout=20)
    except Exception:
        logger.exception("请求 YouTube 频道页失败: %s", url)
        raise

    if resp.status_code != 200:
        raise SubscriptionError(
            "请求 %s 返回 HTTP %s（handle 可能不存在，或触发反爬拦截）" % (url, resp.status_code),
            status_code=422,
        )

    html = resp.text
    # 提取优先级：① channelId ② externalId ③ canonical link
    patterns = (
        ("channelId", r'"channelId":"(UC[\w-]{16,})"'),
        ("externalId", r'"externalId":"(UC[\w-]{16,})"'),
        ("canonical", r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]+)">'),
    )
    channel_id = None
    for name, pattern in patterns:
        match = re.search(pattern, html)
        if match:
            channel_id = match.group(1)
            logger.info("通过 %s 正则提取到 Channel ID: %s", name, channel_id)
            break

    if not channel_id:
        raise SubscriptionError(
            "无法从页面解析出 Channel ID，可能页面结构变化或触发了反爬，请检查 handle 是否正确（注意大小写）",
            status_code=422,
        )

    # 拼装两条 RSS 链接：
    # 1) 原生视频 RSS（官方，无需 RSSHub）
    url_video = "https://www.youtube.com/feeds/videos.xml?channel_id=" + channel_id
    # 2) RSSHub 社区动态 RSS：按 plan.md 原文保留 @；
    #    若使用的 RSSHub 版本要求不带 @，可去掉下面这一行的 "@"
    url_community = RSSHUB_BASE_URL + "/youtube/community/@" + handle

    logger.info("拼装 YouTube 两条 RSS 链接: url_video=%s url_community=%s", url_video, url_community)
    return [url_video, url_community]


# ---------------------------------------------------------------------------
# B 站解析：校验纯数字 UID，再拼装两条 RSS 链接
# ---------------------------------------------------------------------------
def _resolve_bilibili(handle):
    """校验 B 站 UID（必须为纯数字），拼装视频与动态两条 RSS 链接。"""
    handle = handle.strip()
    if not re.fullmatch(r"\d+", handle):
        raise SubscriptionError("B 站 handle 必须是纯数字 UID", status_code=400)

    uid = handle
    url_video = RSSHUB_BASE_URL + "/bilibili/user/video/" + uid
    url_community = RSSHUB_BASE_URL + "/bilibili/user/dynamic/" + uid
    logger.info("拼装 B 站两条 RSS 链接: url_video=%s url_community=%s", url_video, url_community)
    return [url_video, url_community]


# ---------------------------------------------------------------------------
# 推送：通过 greader subscription/edit 接口把一条链接订阅到指定分类
# 参数说明：
#   s  = feed/<订阅源URL>，表示订阅源的完整标识
#   a  = subscribe，表示执行"添加订阅"动作
#   ac = user/-/label/<分类名>，表示把订阅归入名为 <分类名> 的分类
# ---------------------------------------------------------------------------
def _push_to_freshrss(url, category):
    data = {
        "s": "feed/" + url,
        "a": "subscribe",
        "ac": "user/-/label/" + category,
    }
    resp = requests.post(
        SUBSCRIPTION_EDIT_URL,
        data=data,
        headers={"Authorization": _basic_auth_header()},
        timeout=20,
    )
    detail = resp.text[:200]
    logger.info(
        "推送订阅 %s 结果: HTTP %s, 响应摘要: %s",
        url,
        resp.status_code,
        detail,
    )
    return {
        "url": url,
        "ok": resp.status_code == 200,
        "status": resp.status_code,
        "detail": detail,
    }


# ---------------------------------------------------------------------------
# 路由 4：添加订阅
# 请求体: {"platform": "youtube|bilibili", "handle": "...", "category": "..."}
# ---------------------------------------------------------------------------
@app.route("/api/add-subscription", methods=["POST"])
def api_add_subscription():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        body = {}

    platform = str(body.get("platform") or "").strip().lower()
    handle = str(body.get("handle") or "").strip()
    category = str(body.get("category") or "").strip()

    # 参数校验：非法平台 / 缺失参数直接返回 400
    if platform not in ("youtube", "bilibili"):
        return jsonify({"error": "platform 参数非法，仅支持 youtube / bilibili"}), 400
    if not handle:
        return jsonify({"error": "handle 参数缺失或为空"}), 400
    if not category:
        return jsonify({"error": "category 参数缺失或为空"}), 400

    # 第一步：解析 handle 并拼装两条 RSS 链接
    try:
        if platform == "youtube":
            links = _resolve_youtube(handle)
        else:
            links = _resolve_bilibili(handle)
    except SubscriptionError as err:
        logger.warning("解析订阅失败: %s", err)
        return jsonify({"error": str(err)}), err.status_code
    except Exception:
        logger.exception("解析订阅链接时发生未预期异常")
        return jsonify({"error": "解析订阅链接时发生内部错误"}), 500

    # 第二步：逐条推送到 FreshRSS
    results = []
    for url in links:
        try:
            results.append(_push_to_freshrss(url, category))
        except Exception:
            logger.exception("推送订阅 %s 时发生异常", url)
            results.append(
                {
                    "url": url,
                    "ok": False,
                    "status": None,
                    "detail": "推送过程中发生异常，详见服务端日志",
                }
            )

    ok_results = [r for r in results if r["ok"]]
    errors = [r["detail"] for r in results if not r["ok"]]

    # 至少一条成功 -> 200；全部失败 -> 502
    if ok_results:
        return jsonify({"success": True, "results": results, "errors": errors}), 200
    return jsonify({"success": False, "error": "所有订阅推送均失败: " + " | ".join(errors)}), 502


# ---------------------------------------------------------------------------
# 入口：绑定 0.0.0.0，端口来自环境变量 PORT
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
