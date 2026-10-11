// Testseiten: jeder Klick wird in window.geklickt (Hauptseite) festgehalten
window.geklickt = [];
window.addEventListener('message', (e) => {
  if (e.data && e.data.geklickt) {
    window.geklickt.push(e.data.geklickt);
    document.querySelectorAll('[id^=sp_message_container_]').forEach((c) => c.remove());
  }
});
function merken(el, wert, schliessen) {
  el.addEventListener('click', (ev) => {
    ev.preventDefault();
    window.geklickt.push(wert);
    if (schliessen) document.querySelector(schliessen)?.remove();
  });
}
