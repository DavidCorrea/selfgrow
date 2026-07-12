// Simple mock agent event emitter
class AgentEmitter {
  constructor() {
    this.listeners = [];
    // Simulate events every few seconds
    setInterval(() => {
      const events = [
        'A flower has blossomed.',
        'A gentle breeze rustles the leaves.',
        'A curious creature has arrived.',
        'Petals drift away as a flower fades.'
      ];
      const msg = events[Math.floor(Math.random() * events.length)];
      this.emit(msg);
    }, 8000);
  }
  on(cb) { this.listeners.push(cb); }
  emit(msg) { this.listeners.forEach(cb => cb(msg)); }
}

const liveRegion = document.getElementById('agent-live');
const emitter = new AgentEmitter();

emitter.on(message => {
  liveRegion.textContent = '';
  // Clear then set to ensure screen readers read change
  requestAnimationFrame(() => {
    liveRegion.textContent = message;
  });
  // Clear after short time to avoid repeated announcements
  setTimeout(() => {
    liveRegion.textContent = '';
  }, 4000);
});
