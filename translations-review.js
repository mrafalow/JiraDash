/* Recently Closed — translations decision + display (localStorage + server sync) */
(function(global){
  'use strict';

  const STORAGE_KEY = 'studio-titan-translations-choice-v1';
  let choicesSynced = false;

  function readLocalChoices(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch(_){
      return {};
    }
  }

  function writeLocalChoices(choices){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choices || {}));
    } catch(_){ /* ignore quota */ }
  }

  function loadChoices(){
    return readLocalChoices();
  }

  function choicesEqual(a, b){
    const x = a && typeof a === 'object' ? a : {};
    const y = b && typeof b === 'object' ? b : {};
    const keys = new Set(Object.keys(x).concat(Object.keys(y)));
    for(const k of keys){
      if(x[k] !== y[k]) return false;
    }
    return true;
  }

  async function persistChoicePatch(ticketKey, choice){
    try{
      await fetch('/api/translations/choices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketKey: ticketKey, choice: choice })
      });
    } catch(_){
      /* offline or no server */
    }
  }

  async function persistChoicesReplace(choices){
    try{
      await fetch('/api/translations/choices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'replace', choices: choices || {} })
      });
    } catch(_){
      /* offline or no server */
    }
  }

  async function ensureChoicesSynced(){
    if(choicesSynced) return loadChoices();
    const local = readLocalChoices();
    let server = {};
    try{
      const res = await fetch('/api/translations/choices');
      if(res.ok){
        const data = await res.json();
        if(data && typeof data === 'object') server = data;
      }
    } catch(_){
      /* use local only */
    }
    const merged = Object.assign({}, server, local);
    writeLocalChoices(merged);
    if(!choicesEqual(merged, server)){
      await persistChoicesReplace(merged);
    }
    choicesSynced = true;
    return merged;
  }

  function saveChoice(ticketKey, choice){
    if(!ticketKey) return;
    const choices = loadChoices();
    if(choice === 'needed' || choice === 'not-needed'){
      choices[ticketKey] = choice;
    } else {
      delete choices[ticketKey];
    }
    writeLocalChoices(choices);
    persistChoicePatch(ticketKey, choice);
  }

  function getChoice(ticketKey){
    const c = loadChoices()[ticketKey];
    return c === 'needed' || c === 'not-needed' ? c : null;
  }

  function subtaskByType(ticket, type){
    return (ticket && ticket.subtasks || []).find(st => st && st.type === type) || null;
  }

  function prodValClosed(ticket){
    const st = subtaskByType(ticket, 'PRODVAL');
    return !!(st && st.status === 'Closed');
  }

  function translationsSubtask(ticket){
    return subtaskByType(ticket, 'TRANSLATIONS');
  }

  /** Jira workflow bucket for an open Translations subtask. */
  function translationsSubtaskPhase(tr){
    if(!tr) return 'none';
    const s = String(tr.status || '').trim().toLowerCase();
    if(!s || s === 'closed') return 'closed';
    if(
      s === 'not started' ||
      s === 'open' ||
      s === 'to do' ||
      s === 'todo' ||
      s === 'backlog' ||
      s === 'new'
    ){
      return 'not-started';
    }
    if(
      s === 'in progress' ||
      s === 'in evaluation' ||
      s === 'in review' ||
      s.indexOf('progress') >= 0
    ){
      return 'in-flight';
    }
    return 'not-started';
  }

  /** MS owns translation follow-up when parent assignee is not you (typical CONTENT handoff). */
  function isMsTranslationsHandoff(ticket){
    if(!ticket) return false;
    if(ticket.assigneeIsCurrentUser === true) return false;
    const key = String(ticket.key || '').toUpperCase();
    if(key.startsWith('CONTENT-')) return true;
    if(ticket.managedServices || ticket.scoringProfile === 'ms') return true;
    return false;
  }

  /**
   * Display state for Recently Closed translations column.
   * awaiting-prodval | review | all-closed | not-started | pending | nudge-ms
   */
  function closedTranslationsState(ticket){
    if(!prodValClosed(ticket)) return { state: 'awaiting-prodval' };

    const tr = translationsSubtask(ticket);
    const choice = getChoice(ticket.key);

    if(choice === 'not-needed'){
      return { state: 'all-closed', reason: 'marked-not-needed' };
    }

    if(tr && tr.status === 'Closed'){
      return { state: 'all-closed', reason: 'subtask-closed' };
    }

    if(tr && tr.status !== 'Closed'){
      const phase = translationsSubtaskPhase(tr);
      if(phase === 'in-flight'){
        return { state: 'pending', reason: 'in-flight' };
      }
      return { state: 'not-started', reason: 'subtask-not-started' };
    }

    if(choice === 'needed'){
      if(isMsTranslationsHandoff(ticket)){
        return { state: 'nudge-ms', reason: 'needed-ms' };
      }
      return { state: 'not-started', reason: 'needed-yours' };
    }

    return { state: 'review', reason: 'undecided' };
  }

  function needsTranslationAction(ticket){
    const s = closedTranslationsState(ticket).state;
    return s === 'review' || s === 'not-started' || s === 'pending' || s === 'nudge-ms';
  }

  function statusLabel(info){
    switch(info.state){
      case 'awaiting-prodval': return 'Awaiting Prod Val';
      case 'review': return 'Decide translations';
      case 'all-closed': return 'All closed';
      case 'not-started': return 'Not started';
      case 'pending': return 'In progress';
      case 'nudge-ms': return 'Nudge MS';
      default: return '—';
    }
  }

  const api = {
    STORAGE_KEY,
    loadChoices,
    saveChoice,
    getChoice,
    ensureChoicesSynced,
    prodValClosed,
    closedTranslationsState,
    needsTranslationAction,
    statusLabel,
    isMsTranslationsHandoff,
    translationsSubtaskPhase
  };

  global.TranslationsReview = api;
  if(typeof module !== 'undefined' && module.exports){
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
