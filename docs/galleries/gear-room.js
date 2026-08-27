import { registerGallery, getDevice } from '../engine/registry.js';

registerGallery('gear-room', {
  name: 'Gear Gallery',
  describe(state) {
    // The device assigned to this gallery by the seed-based arrangement
    // (the Gear Gallery can host a device when the shuffle places one here).
    const deviceId = state && state.galleryDeviceMap ? state.galleryDeviceMap['gear-room'] : null;
    const device = deviceId ? getDevice(deviceId) : null;
    const deviceName = device ? device.name : deviceId;
    const deviceFound = !!(deviceId && state && Array.isArray(state.foundDevices) && state.foundDevices.includes(deviceId));

    let hintLine;
    if (!deviceId || !deviceName) {
      hintLine = 'Somewhere in the mechanism, a tension wheel sits silent, waiting for hands that know how to turn it.';
    } else if (deviceFound) {
      hintLine = `The teeth where the ${deviceName} was recovered now grind on empty, the mechanism still restless.`;
    } else {
      hintLine = `Somewhere in the mechanism, a ${deviceName} sits silent, waiting for hands that know how to use it.`;
    }

    const lines = [
      'The Gear Gallery. A vast circular chamber where interlocking brass',
      'gears of every size mesh and turn, their teeth catching the dim light',
      'in rhythmic flashes. The floor vibrates with the machine\'s pulse,',
      'transmitted through the massive gear trains that rise from the depths',
      'below. The Sentinel\'s approach is heralded by the grinding of stripped',
      'teeth — a screeching sound that echoes through the gearwork long before',
      'it arrives.',
      '',
      hintLine,
    ];

    // Pressure-level reactivity — the gearwork strains with the pressure dial
    if (state && state.pressure > 60) {
      lines.push('The gears groan and bind, their teeth straining against the rising pressure as steam leaks from the bearings.');
    } else if (state && state.pressure < 20) {
      lines.push('The gears turn slowly, almost lazily, the mechanism winding down to a near-standstill.');
    }

    return lines.join('\n');
  },
});