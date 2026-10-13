/* Recently Closed — translations decision + display (browser localStorage) */
(function(global){
  'use strict';

  const STORAGE_KEY = 'studio-titan-translations-choice-v1';

  function loadChoices(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch(_){
      return {};
    }
  }

  function saveChoice(ticketKey, choice){
    if(!ticketKey) return;
    const choices = loadChoices();
    if(choice === 'needed' || choice === 'not-needed'){
      choices[ticketKey] = choice;
    } else {
      delete choices[ticketKey];
    }
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choices));
    } catch(_){ /* ignore quota */ }
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

  function openTranslationsSubtask(ticket){
    const st = translationsSubtask(ticket);
    return !!(st && st.status !== 'Closed');
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
   * awaiting-prodval | review | all-closed | pending | nudge-ms
   */
  function closedTranslationsState(ticket){
    if(!prodValClosed(ticket)) return { state: 'awaiting-prodval' };

    const trOpen = openTranslationsSubtask(ticket);
    const tr = translationsSubtask(ticket);
    const choice = getChoice(ticket.key);

    if(trOpen){
      return { state: 'pending', reason: 'open-subtask' };
    }

    if(tr && tr.status === 'Closed'){
      return { state: 'all-closed', reason: 'subtask-closed' };
    }

    if(choice === 'not-needed'){
      return { state: 'all-closed', reason: 'marked-not-needed' };
    }

    if(choice === 'needed'){
      if(isMsTranslationsHandoff(ticket)){
        return { state: 'nudge-ms', reason: 'needed-ms' };
      }
      return { state: 'pending', reason: 'needed-yours' };
    }

    return { state: 'review', reason: 'undecided' };
  }

  function needsTranslationAction(ticket){
    const s = closedTranslationsState(ticket).state;
    return s === 'review' || s === 'pending' || s === 'nudge-ms';
  }

  function statusLabel(state){
    switch(state.state){
      case 'awaiting-prodval': return 'Awaiting Prod Val';
      case 'review': return 'Decide translations';
      case 'all-closed': return 'All closed';
      case 'pending': return 'Translations pending';
      case 'nudge-ms': return 'Nudge MS';
      default: return '—';
    }
  }

  const api = {
    STORAGE_KEY,
    loadChoices,
    saveChoice,
    getChoice,
    prodValClosed,
    closedTranslationsState,
    needsTranslationAction,
    statusLabel,
    isMsTranslationsHandoff
  };

  global.TranslationsReview = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
