import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import IntelligentSurface from './IntelligentSurface.jsx';
import './preview.css';

const actionRef = {action_id:'action:reminder:preview', expected_revision:3, approval_ref:'approval:reminder:preview', idempotency_key:'idem:reminder:preview:1', cancel_token:'cancel:reminder:preview', expires_at:4102444800};
const blocks = [{schema_version:1, block_id:'block:reminder:preview', conversation_id:'conversation:preview', turn_id:'turn:preview', source:'withu', status_version:1, visibility:'private_preview', kind:'selection', action_ref:actionRef, payload:{title:'Preview a local reminder', options:[{id:'tomorrow-morning', label:'Tomorrow at 09:00', description:'Local reminder draft', version:2}]}}];

function Preview() {
  const [events, setEvents] = useState([]);
  const onAction = intent => { setEvents(current => [{type:'intent', channel:intent.input_channel, action_id:intent.action_id, option_id:intent.option_id, option_version:intent.option_version}, ...current].slice(0,4)); return undefined; };
  return <><IntelligentSurface blocks={blocks} onAction={onAction} testPreview /><aside className="preview-event-log" aria-label="Preview adapter event log"><strong>Adapter event log</strong><p>Fixture only. No reminder is created. No production side effect.</p>{events.length ? events.map((event, index) => <code key={`${event.channel}-${index}`}>{event.channel} → {event.action_id} · {event.option_id || 'no option'} · v{event.option_version ?? 'n/a'}</code>) : <span>No typed intent yet.</span>}</aside></>;
}

createRoot(document.getElementById('intelligent-ui-preview')).render(<Preview />);
