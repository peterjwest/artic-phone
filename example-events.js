document.querySelectorAll('canvas')[3].dispatchEvent(new MouseEvent('mousedown', {
  'view': window,
  'bubbles': true,
  'cancelable': false,
  'screenX': 800,
  'screenY': 120,
  'clientX': 800,
  'clientY': 120,
  'which': 1,
  'ctrlKey': true
}))
document.querySelectorAll('canvas')[3].dispatchEvent(new MouseEvent('mousemove', {
  'view': window,
  'bubbles': true,
  'cancelable': true,
  'screenX': 820,
  'screenY': 130,
  'clientX': 820,
  'clientY': 130,
  'movementX': 10,
  'movementY': 0,
  'composed': true,
  'isPrimary': true,
  'which': 0,
  'ctrlKey': true,
  target: document.querySelectorAll('canvas')[3],
}))
document.querySelectorAll('canvas')[3].dispatchEvent(new MouseEvent('mousemove', {
  'view': window,
  'bubbles': true,
  'cancelable': true,
  'screenX': 820,
  'screenY': 140,
  'clientX': 820,
  'clientY': 140,
  'movementX': 0,
  'movementY': 10,
  'composed': true,
  'isPrimary': true,
  'which': 0,
  'ctrlKey': true
}))
document.querySelectorAll('canvas')[3].dispatchEvent(new MouseEvent('mouseup', {
  'view': window,
  'bubbles': true,
  'cancelable': false,
  'screenX': 820,
  'screenY': 140,
  'clientX': 820,
  'clientY': 140,
  'ctrlKey': true
}))