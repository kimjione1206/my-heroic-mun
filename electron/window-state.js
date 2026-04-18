// 창 위치·크기 JSON 영속 저장.
const path = require('path');
const fs = require('fs');
const { getUserDataPath } = require('./userdata');

function filePath() {
  return path.join(getUserDataPath(), 'window-state.json');
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    return {};
  }
}

function save(all) {
  try {
    const file = filePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all, null, 2));
  } catch (e) {
    console.error('[window-state] save failed:', e.message);
  }
}

function loadState(name, defaults) {
  const all = load();
  const saved = all[name] || {};
  return { ...defaults, ...saved };
}

function saveState(name, bounds) {
  if (!bounds) return;
  const all = load();
  all[name] = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  save(all);
}

module.exports = { loadState, saveState };
