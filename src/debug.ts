// 调试信息
console.log('Popup HTML loaded');
console.log('Chrome API available:', typeof chrome !== 'undefined');
if (typeof chrome !== 'undefined') {
  console.log('Chrome runtime available:', !!chrome.runtime);
  console.log('Chrome tabs available:', !!chrome.tabs);
  console.log('Chrome storage available:', !!chrome.storage);
}