"use strict";

const STORAGE_KEY = "wocchi-desk-v1";
const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const PRIORITY_LABEL = { high: "高", medium: "中", low: "低" };

const state = { events: [], tasks: [], selectedDate: toDateKey(new Date()) };
const elements = {};

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {
  cacheElements();
  loadState();
  bindEvents();
  elements.selectedDate.value = state.selectedDate;
  render();
}

function cacheElements() {
  ["selected-date", "selected-date-title", "selected-date-subtitle", "report-status", "report-summary",
    "report-recommendation", "report-next-action", "report-alerts", "schedule-count", "event-list",
    "free-time-list", "task-count", "task-list", "event-dialog", "event-form", "event-dialog-title",
    "event-id", "event-title", "event-date", "event-start", "event-end", "event-notes", "event-error",
    "task-dialog", "task-form", "task-dialog-title", "task-id", "task-title", "task-date", "task-priority",
    "task-duration", "task-notes", "task-error", "toast"].forEach((id) => {
    elements[toCamel(id)] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll(".date-preset").forEach((button) => button.addEventListener("click", () => {
    const date = new Date();
    date.setDate(date.getDate() + Number(button.dataset.offset));
    setSelectedDate(toDateKey(date));
  }));
  elements.selectedDate.addEventListener("change", () => setSelectedDate(elements.selectedDate.value));
  document.getElementById("open-event-modal").addEventListener("click", () => openEventDialog());
  document.getElementById("add-event-inline").addEventListener("click", () => openEventDialog());
  document.getElementById("open-task-modal").addEventListener("click", () => openTaskDialog());
  elements.eventForm.addEventListener("submit", saveEvent);
  elements.taskForm.addEventListener("submit", saveTask);
  document.querySelectorAll(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  [elements.eventDialog, elements.taskDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
  elements.eventList.addEventListener("click", handleEventAction);
  elements.taskList.addEventListener("click", handleTaskAction);
  elements.taskList.addEventListener("change", handleTaskToggle);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.events) && Array.isArray(saved.tasks)) {
      state.events = saved.events.filter(isValidStoredEvent);
      state.tasks = saved.tasks.filter(isValidStoredTask);
    }
  } catch (error) {
    console.warn("保存データを読み込めなかったため、空の状態で開始します。", error);
  }
}

function saveState(message) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ events: state.events, tasks: state.tasks }));
    showToast(message);
  } catch (error) {
    console.warn("データを保存できませんでした。", error);
    showToast("ブラウザに保存できませんでした");
  }
}

function isValidStoredEvent(item) {
  return item && typeof item.id === "string" && typeof item.title === "string" && isDateKey(item.date)
    && isTime(item.start) && isTime(item.end) && item.start < item.end;
}

function isValidStoredTask(item) {
  return item && typeof item.id === "string" && typeof item.title === "string" && isDateKey(item.date)
    && PRIORITY_WEIGHT[item.priority] && Number.isFinite(Number(item.duration));
}

function setSelectedDate(date) {
  if (!isDateKey(date)) return;
  state.selectedDate = date;
  elements.selectedDate.value = date;
  render();
}

function render() {
  updateDateHeader();
  const events = getEventsForDate(state.selectedDate);
  const tasks = getRelevantTasks(state.selectedDate);
  const overlaps = findOverlaps(events);
  renderEvents(events, overlaps);
  renderTasks(tasks);
  renderFreeTimes(findFreeTimes(events));
  renderReport(events, tasks, overlaps);
}

function updateDateHeader() {
  const date = fromDateKey(state.selectedDate);
  const today = toDateKey(new Date());
  const tomorrow = addDays(today, 1);
  const label = state.selectedDate === today ? "今日" : state.selectedDate === tomorrow ? "明日" : "指定日";
  elements.selectedDateTitle.textContent = `${label}・${new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" }).format(date)}`;
  elements.selectedDateSubtitle.textContent = state.selectedDate === today ? "今日の状況を整理しています" : "選択した日の計画を表示しています";
  document.querySelectorAll(".date-preset").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.offset) === (state.selectedDate === today ? 0 : state.selectedDate === tomorrow ? 1 : -1));
  });
}

function getEventsForDate(date) {
  return state.events.filter((item) => item.date === date).sort((a, b) => a.start.localeCompare(b.start));
}

function getRelevantTasks(date) {
  return state.tasks.filter((task) => task.date <= date).sort(compareTasks);
}

function compareTasks(a, b) {
  if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
  const overdueA = a.date < state.selectedDate ? 1 : 0;
  const overdueB = b.date < state.selectedDate ? 1 : 0;
  if (overdueA !== overdueB) return overdueB - overdueA;
  if (PRIORITY_WEIGHT[a.priority] !== PRIORITY_WEIGHT[b.priority]) return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return (a.createdAt || "").localeCompare(b.createdAt || "");
}

function renderEvents(events, overlaps) {
  elements.scheduleCount.textContent = `${events.length}件の予定`;
  elements.eventList.replaceChildren();
  if (!events.length) return elements.eventList.append(emptyState("この日の予定はありません"));
  const overlapIds = new Set(overlaps.flatMap((pair) => pair.map((item) => item.id)));
  events.forEach((item) => {
    const row = createElement("article", `item${overlapIds.has(item.id) ? " is-overlap" : ""}`);
    const time = createElement("div", "time-block", `${item.start}–${item.end}`);
    const body = createElement("div");
    body.append(createElement("h3", "item-title", item.title));
    const meta = createElement("div", "item-meta");
    meta.append(createElement("span", "", `${minutesBetween(item.start, item.end)}分`));
    if (overlapIds.has(item.id)) meta.append(createElement("span", "badge badge-overdue", "重複あり"));
    body.append(meta);
    if (item.notes) body.append(createElement("p", "item-notes", item.notes));
    row.append(time, body, actionButtons(item.id, "event"));
    elements.eventList.append(row);
  });
}

function renderTasks(tasks) {
  const active = tasks.filter((item) => !item.completed);
  elements.taskCount.textContent = `未完了 ${active.length}件（優先順）`;
  elements.taskList.replaceChildren();
  if (!tasks.length) return elements.taskList.append(emptyState("この日までのタスクはありません"));
  tasks.forEach((item) => {
    const row = createElement("article", `item${item.completed ? " is-complete" : ""}`);
    const checkbox = createElement("input", "task-check");
    checkbox.type = "checkbox"; checkbox.checked = Boolean(item.completed); checkbox.dataset.id = item.id;
    checkbox.setAttribute("aria-label", `${item.title}を完了にする`);
    const body = createElement("div");
    body.append(createElement("h3", "item-title", item.title));
    const meta = createElement("div", "item-meta");
    meta.append(createElement("span", `badge badge-${item.priority}`, `優先度 ${PRIORITY_LABEL[item.priority]}`));
    meta.append(createElement("span", "", `${item.duration}分`));
    meta.append(createElement("span", item.date < state.selectedDate && !item.completed ? "badge badge-overdue" : "", item.date < state.selectedDate ? `期限超過 ${formatShortDate(item.date)}` : `期限 ${formatShortDate(item.date)}`));
    body.append(meta);
    if (item.notes) body.append(createElement("p", "item-notes", item.notes));
    row.append(checkbox, body, actionButtons(item.id, "task"));
    elements.taskList.append(row);
  });
}

function actionButtons(id, type) {
  const actions = createElement("div", "item-actions");
  const edit = createElement("button", "icon-button", "✎");
  edit.type = "button"; edit.dataset.action = "edit"; edit.dataset.id = id; edit.setAttribute("aria-label", "編集");
  const remove = createElement("button", "icon-button danger", "×");
  remove.type = "button"; remove.dataset.action = "delete"; remove.dataset.id = id; remove.setAttribute("aria-label", "削除");
  actions.dataset.type = type; actions.append(edit, remove);
  return actions;
}

function renderFreeTimes(freeTimes) {
  elements.freeTimeList.replaceChildren();
  if (!freeTimes.length) return elements.freeTimeList.append(createElement("span", "muted", "30分以上の空きはありません"));
  freeTimes.forEach((slot) => elements.freeTimeList.append(createElement("span", "chip", `${toTime(slot.start)}–${toTime(slot.end)}（${slot.end - slot.start}分）`)));
}

function renderReport(events, tasks, overlaps) {
  const freeTimes = findFreeTimes(events);
  const activeTasks = tasks.filter((item) => !item.completed);
  const totalTaskMinutes = activeTasks.reduce((sum, item) => sum + Number(item.duration), 0);
  const freeMinutes = freeTimes.reduce((sum, slot) => sum + slot.end - slot.start, 0);
  const warningCount = overlaps.length + (totalTaskMinutes > freeMinutes ? 1 : 0) + activeTasks.filter((item) => item.date < state.selectedDate).length;
  elements.reportStatus.textContent = warningCount ? `要確認 ${warningCount}件` : "順調です";
  elements.reportStatus.style.background = warningCount ? "#fff1d9" : "#e4f3ed";
  elements.reportStatus.style.color = warningCount ? "#9a5b13" : "#21745a";
  elements.reportSummary.replaceChildren();
  [[events.length, "今日の予定"], [activeTasks.length, "未完了タスク"], [freeTimes.length, "空き時間"], [overlaps.length, "予定の重複"]]
    .forEach(([value, label]) => {
      const metric = createElement("div", "metric"); metric.append(createElement("strong", "", String(value)), createElement("span", "", label)); elements.reportSummary.append(metric);
    });
  const topTasks = activeTasks.slice(0, 5);
  elements.reportRecommendation.replaceChildren();
  if (topTasks.length) {
    elements.reportRecommendation.append(createElement("p", "", `「${topTasks[0].title}」から始めましょう（目安 ${topTasks[0].duration}分）。`));
    const list = createElement("ol", "plain-list"); topTasks.forEach((task) => list.append(createElement("li", "", task.title))); elements.reportRecommendation.append(list);
  } else elements.reportRecommendation.append(createElement("p", "muted", "取り組むタスクはありません。"));
  renderNextAction(events, activeTasks);
  elements.reportAlerts.replaceChildren();
  const alerts = [];
  if (overlaps.length) alerts.push(`${overlaps.length}組の予定が重複しています。開始・終了時刻を見直してください。`);
  if (totalTaskMinutes > freeMinutes) alerts.push(`タスクは合計${totalTaskMinutes}分、空き時間は${freeMinutes}分です。今日中に終わらない可能性があります。`);
  const overdue = activeTasks.filter((item) => item.date < state.selectedDate).length;
  if (overdue) alerts.push(`期限を過ぎたタスクが${overdue}件あります。`);
  if (!alerts.length) alerts.push("大きな注意点はありません。余裕を持って進められそうです。");
  alerts.forEach((alert) => elements.reportAlerts.append(createElement("li", "", alert)));
}

function renderNextAction(events, tasks) {
  elements.reportNextAction.replaceChildren();
  const now = new Date();
  const viewingToday = state.selectedDate === toDateKey(now);
  const nowMinutes = viewingToday ? now.getHours() * 60 + now.getMinutes() : DAY_START;
  const nextEvent = events.find((item) => toMinutes(item.start) > nowMinutes);
  const available = nextEvent ? toMinutes(nextEvent.start) - nowMinutes : DAY_END - nowMinutes;
  const doable = tasks.find((task) => Number(task.duration) <= available);
  let message;
  if (nextEvent && available > 0 && doable) message = `次の「${nextEvent.title}」まで約${available}分。「${doable.title}」に取り組めます。`;
  else if (nextEvent && available > 0) message = `次の「${nextEvent.title}」まで約${available}分。準備や短い休憩に使いましょう。`;
  else if (doable) message = `予定の区切りまでに「${doable.title}」を進められます。`;
  else message = "次の予定とタスクはありません。振り返りや休息に使えます。";
  elements.reportNextAction.append(createElement("p", "", message));
}

function findOverlaps(events) {
  const result = [];
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      if (events[j].start < events[i].end && events[j].end > events[i].start) result.push([events[i], events[j]]);
    }
  }
  return result;
}

function findFreeTimes(events) {
  const intervals = events.map((event) => ({ start: Math.max(DAY_START, toMinutes(event.start)), end: Math.min(DAY_END, toMinutes(event.end)) }))
    .filter((item) => item.end > DAY_START && item.start < DAY_END).sort((a, b) => a.start - b.start);
  const merged = [];
  intervals.forEach((item) => {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end); else merged.push({ ...item });
  });
  const free = []; let cursor = DAY_START;
  merged.forEach((item) => { if (item.start - cursor >= 30) free.push({ start: cursor, end: item.start }); cursor = Math.max(cursor, item.end); });
  if (DAY_END - cursor >= 30) free.push({ start: cursor, end: DAY_END });
  return free;
}

function openEventDialog(item = null) {
  elements.eventForm.reset(); elements.eventError.textContent = "";
  elements.eventDialogTitle.textContent = item ? "予定を編集" : "予定を追加";
  elements.eventId.value = item?.id || ""; elements.eventTitle.value = item?.title || "";
  elements.eventDate.value = item?.date || state.selectedDate; elements.eventStart.value = item?.start || "09:00";
  elements.eventEnd.value = item?.end || "10:00"; elements.eventNotes.value = item?.notes || "";
  elements.eventDialog.showModal(); elements.eventTitle.focus();
}

function openTaskDialog(item = null) {
  elements.taskForm.reset(); elements.taskError.textContent = "";
  elements.taskDialogTitle.textContent = item ? "タスクを編集" : "タスクを追加";
  elements.taskId.value = item?.id || ""; elements.taskTitle.value = item?.title || "";
  elements.taskDate.value = item?.date || state.selectedDate; elements.taskPriority.value = item?.priority || "medium";
  elements.taskDuration.value = item?.duration || 30; elements.taskNotes.value = item?.notes || "";
  elements.taskDialog.showModal(); elements.taskTitle.focus();
}

function saveEvent(event) {
  event.preventDefault();
  const data = { id: elements.eventId.value || createId(), title: elements.eventTitle.value.trim(), date: elements.eventDate.value,
    start: elements.eventStart.value, end: elements.eventEnd.value, notes: elements.eventNotes.value.trim(), createdAt: new Date().toISOString() };
  if (!data.title || !isDateKey(data.date) || !isTime(data.start) || !isTime(data.end)) return showFormError(elements.eventError, "必須項目を正しく入力してください。");
  if (data.start >= data.end) return showFormError(elements.eventError, "終了時刻は開始時刻より後にしてください。");
  const index = state.events.findIndex((item) => item.id === data.id);
  if (index >= 0) data.createdAt = state.events[index].createdAt || data.createdAt;
  index >= 0 ? state.events.splice(index, 1, data) : state.events.push(data);
  saveState(index >= 0 ? "予定を更新しました" : "予定を追加しました"); elements.eventDialog.close(); render();
}

function saveTask(event) {
  event.preventDefault();
  const duration = Number(elements.taskDuration.value);
  const data = { id: elements.taskId.value || createId(), title: elements.taskTitle.value.trim(), date: elements.taskDate.value,
    priority: elements.taskPriority.value, duration, notes: elements.taskNotes.value.trim(), completed: false, createdAt: new Date().toISOString() };
  if (!data.title || !isDateKey(data.date) || !PRIORITY_WEIGHT[data.priority]) return showFormError(elements.taskError, "必須項目を正しく入力してください。");
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) return showFormError(elements.taskError, "所要時間は5〜480分で入力してください。");
  const index = state.tasks.findIndex((item) => item.id === data.id);
  if (index >= 0) { data.completed = state.tasks[index].completed; data.createdAt = state.tasks[index].createdAt || data.createdAt; }
  index >= 0 ? state.tasks.splice(index, 1, data) : state.tasks.push(data);
  saveState(index >= 0 ? "タスクを更新しました" : "タスクを追加しました"); elements.taskDialog.close(); render();
}

function handleEventAction(event) {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const item = state.events.find((entry) => entry.id === button.dataset.id); if (!item) return;
  if (button.dataset.action === "edit") openEventDialog(item);
  else if (window.confirm(`「${item.title}」を削除しますか？`)) { state.events = state.events.filter((entry) => entry.id !== item.id); saveState("予定を削除しました"); render(); }
}

function handleTaskAction(event) {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const item = state.tasks.find((entry) => entry.id === button.dataset.id); if (!item) return;
  if (button.dataset.action === "edit") openTaskDialog(item);
  else if (window.confirm(`「${item.title}」を削除しますか？`)) { state.tasks = state.tasks.filter((entry) => entry.id !== item.id); saveState("タスクを削除しました"); render(); }
}

function handleTaskToggle(event) {
  const item = state.tasks.find((entry) => entry.id === event.target.dataset.id); if (!item) return;
  item.completed = event.target.checked; item.completedAt = item.completed ? new Date().toISOString() : null;
  saveState(item.completed ? "タスクを完了しました" : "未完了に戻しました"); render();
}

function createElement(tag, className = "", text = null) {
  const element = document.createElement(tag); if (className) element.className = className; if (text !== null) element.textContent = text; return element;
}
function emptyState(message) { return createElement("div", "empty-state", message); }
function showFormError(target, message) { target.textContent = message; }
function showToast(message) { elements.toast.textContent = message; elements.toast.classList.add("is-visible"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2200); }
function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function createId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function isDateKey(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(fromDateKey(value).getTime()); }
function isTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function toMinutes(value) { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; }
function toTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function minutesBetween(start, end) { return toMinutes(end) - toMinutes(start); }
function toDateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function fromDateKey(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function addDays(dateKey, count) { const date = fromDateKey(dateKey); date.setDate(date.getDate() + count); return toDateKey(date); }
function formatShortDate(dateKey) { return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(fromDateKey(dateKey)); }
