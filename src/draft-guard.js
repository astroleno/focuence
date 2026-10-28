import {el} from './ui.js';

// Protect an editor's in-page exit without persisting or submitting its draft.
export function createDraftGuard({root, snapshot, id, description = '更改尚未保存。继续编辑，或明确放弃本次更改。', fallback, scrollRoot = root}) {
  const initial = JSON.stringify(snapshot());
  let prompt, proceed, position;
  const remember = target => {
    if (!root()?.contains(target) || !target.matches('input,textarea,select')) return;
    position = {id: target.id, node: target, start: target.selectionStart, end: target.selectionEnd, scroll: scrollRoot()?.scrollTop};
  };
  const onFocusOut = event => remember(event.target);
  document.addEventListener('focusout', onFocusOut);
  function dispose() {
    document.removeEventListener('focusout', onFocusOut);
    prompt?.remove(); prompt = null; proceed = null;
  }
  function requestExit(callback) {
    if (JSON.stringify(snapshot()) === initial) { callback(); return true; }
    remember(document.activeElement);
    proceed = callback;
    if (!prompt?.isConnected) {
      const keep = el('button', {id: id + '-keep-editing', type: 'button', class: 'memory-button primary'}, '继续编辑');
      const discard = el('button', {id: id + '-discard', type: 'button', class: 'memory-button'}, '放弃更改');
      prompt = el('section', {class: 'memory-unsaved', role: 'alert'}, el('p', {}, description), el('div', {class: 'memory-actions'}, keep, discard));
      keep.addEventListener('click', () => {
        prompt.remove(); prompt = null;
        const saved = position?.id && document.getElementById(position.id);
        const target = saved && root()?.contains(saved) ? saved : position?.node?.isConnected ? position.node : fallback?.();
        target?.focus({preventScroll: true});
        if (typeof position?.start === 'number' && typeof target?.setSelectionRange === 'function') {
          try { target.setSelectionRange(position.start, position.end); } catch { /* Non-text inputs have no text range. */ }
        }
        if (position?.scroll != null && scrollRoot()) scrollRoot().scrollTop = position.scroll;
      });
      // The editor owns disposal after a successful exit. A failed handoff
      // must keep the original baseline and focus tracking for the same draft.
      discard.addEventListener('click', () => {
        const action = proceed;
        prompt.remove(); prompt = null; proceed = null;
        action?.();
      });
      root().append(prompt);
    }
    prompt.querySelector('button').focus();
    return false;
  }
  return {requestExit, dispose};
}

export function editorSnapshot(form) {
  return [...form.querySelectorAll('input,textarea,select')].map(node => [node.id, node.type === 'checkbox' ? node.checked : node.value]);
}
