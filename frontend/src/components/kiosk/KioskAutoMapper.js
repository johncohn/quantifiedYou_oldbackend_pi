/**
 * KioskAutoMapper - Automatically maps Muse EEG data to visualization parameters
 *
 * In normal mode, users manually map data sources to parameters via the UI.
 * In kiosk mode, this component automatically maps Muse band powers to
 * matching visualization parameters.
 *
 * Mapping logic:
 * - "Alpha" param <- Muse "Alpha" band power
 * - "Low Beta" param <- Muse "Low beta" band power
 * - "High Beta" param <- Muse "High beta" band power
 * - "Theta" param <- Muse "Theta" band power
 * - "Gamma" param <- Muse "Gamma" band power
 */

import { useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';

// Map visualization parameter names to Muse data stream keys
// Note: Muse uses "Low beta" (lowercase b) but viz might use "Low Beta"
const PARAM_TO_MUSE_MAP = {
  'Alpha': 'Alpha',
  'alpha': 'Alpha',
  'Low Beta': 'Low beta',
  'Low beta': 'Low beta',
  'LowBeta': 'Low beta',
  'High Beta': 'High beta',
  'High beta': 'High beta',
  'HighBeta': 'High beta',
  'Theta': 'Theta',
  'theta': 'Theta',
  'Gamma': 'Gamma',
  'gamma': 'Gamma',
};

// Normalize value to 0-1 range with adaptive scaling
function normalizeValue(value, min, max) {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function KioskAutoMapper() {
  const dispatch = useDispatch();
  const params = useSelector((state) => state.params);
  const dataStream = useSelector((state) => state.dataStream);
  const update = useSelector((state) => state.update);

  // Track min/max for adaptive normalization
  const rangesRef = useRef({});

  useEffect(() => {
    // Only process when there's a stream update
    if (update?.type !== 'stream') return;

    // Find the Muse device in dataStream
    const museDeviceId = Object.keys(dataStream).find(id =>
      id.toLowerCase().includes('muse')
    );

    if (!museDeviceId) return;

    const museData = dataStream[museDeviceId];
    if (!museData) return;

    // For each visualization parameter, try to map from Muse data
    Object.keys(params).forEach(paramName => {
      const museKey = PARAM_TO_MUSE_MAP[paramName];
      if (!museKey) return;

      const rawValue = museData[museKey];
      if (rawValue === undefined || rawValue === null || isNaN(rawValue)) return;

      // Initialize or update adaptive range
      if (!rangesRef.current[paramName]) {
        rangesRef.current[paramName] = { min: rawValue, max: rawValue, samples: 0 };
      }

      const range = rangesRef.current[paramName];
      range.samples++;

      // Expand range if needed (with some decay to handle outliers)
      if (rawValue < range.min) {
        range.min = rawValue;
      } else if (range.samples > 100) {
        // Slowly increase min towards current value (prevents stuck ranges)
        range.min = range.min * 0.999 + rawValue * 0.001;
      }

      if (rawValue > range.max) {
        range.max = rawValue;
      } else if (range.samples > 100) {
        // Slowly decrease max towards current value
        range.max = range.max * 0.999 + rawValue * 0.001;
      }

      // Ensure some minimum range to avoid division issues
      const minRange = 0.001;
      if (range.max - range.min < minRange) {
        range.max = range.min + minRange;
      }

      // Normalize to 0-1
      const normalizedValue = normalizeValue(rawValue, range.min, range.max);

      // Dispatch the update
      dispatch({
        type: 'params/update',
        payload: {
          name: paramName,
          value: normalizedValue,
        },
      });
    });
  }, [update, dataStream, params, dispatch]);

  // Log status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const museDeviceId = Object.keys(dataStream).find(id =>
        id.toLowerCase().includes('muse')
      );

      if (museDeviceId && dataStream[museDeviceId]) {
        const data = dataStream[museDeviceId];
        console.log(`[AUTOMAPPER] Muse data: Alpha=${data.Alpha?.toFixed(3) || 'N/A'} ` +
          `Theta=${data.Theta?.toFixed(3) || 'N/A'} ` +
          `Gamma=${data.Gamma?.toFixed(3) || 'N/A'}`);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [dataStream]);

  // This component doesn't render anything
  return null;
}

export default KioskAutoMapper;
