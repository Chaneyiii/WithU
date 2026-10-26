const actionId = 'action:reminder:preview';
const block = document.querySelector('#preview-block');
const status = document.querySelector('#preview-status');
const statusCopy = document.querySelector('#preview-status-copy');
const actions = document.querySelector('#preview-actions');
const closed = document.querySelector('#preview-closed');
const note = document.querySelector('#preview-note');
const events = document.querySelector('#preview-events');
const receipt = document.querySelector('#preview-receipt');
let eventLog = [];

function setState(name, label) {
  block.className = `intelligent-block intelligent-block-${name}`;
  status.className = `intelligent-status intelligent-status-${name}`;
  statusCopy.textContent = label;
}
function record(channel) {
  eventLog = [`${channel} -> ${actionId}`, ...eventLog].slice(0, 4);
  events.replaceChildren(...eventLog.map(item => { const code = document.createElement('code'); code.textContent = item; return code; }));
  note.hidden = false;
  setState('pending_approval', 'Waiting for approval');
  document.querySelector('#preview-allow').disabled = true;
  document.querySelector('#preview-voice').disabled = true;
}
document.querySelector('#preview-allow').addEventListener('click', () => record('click'));
document.querySelector('#preview-voice').addEventListener('click', () => record('voice'));
document.querySelector('#preview-close').addEventListener('click', () => {
  setState('closed', 'Closed'); actions.hidden = true; closed.hidden = false; receipt.hidden = true;
});
document.querySelector('#preview-recover').addEventListener('click', () => {
  closed.hidden = true; actions.hidden = false; setState('recovering', 'Recovering');
  window.setTimeout(() => setState('ready', 'Can continue'), 250);
});
