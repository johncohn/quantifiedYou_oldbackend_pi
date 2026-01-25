/**
 * HeadlessMuseReceiver - Receives EEG data from the headless Muse service
 *
 * This component connects to the Python Muse service via WebSocket
 * and dispatches band power data to the Redux store.
 *
 * The headless service handles all Bluetooth connection automatically -
 * no user interaction required!
 */

import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

const WS_URL = 'ws://localhost:8766';
const RECONNECT_DELAY = 3000;

export function HeadlessMuseReceiver({ onStatusChange }) {
  const dispatch = useDispatch();
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const [status, setStatus] = useState({
    wsConnected: false,
    museConnected: false,
    deviceName: null
  });

  useEffect(() => {
    let mounted = true;

    const connect = () => {
      if (!mounted) return;

      console.log('[HEADLESS] Connecting to Muse service...');

      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[HEADLESS] WebSocket connected to Muse service');
          if (mounted) {
            setStatus(prev => ({ ...prev, wsConnected: true }));
          }
        };

        ws.onclose = () => {
          console.log('[HEADLESS] WebSocket disconnected, reconnecting...');
          if (mounted) {
            setStatus(prev => ({ ...prev, wsConnected: false, museConnected: false }));
            // Reconnect after delay
            reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
          }
        };

        ws.onerror = (err) => {
          console.error('[HEADLESS] WebSocket error:', err);
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'muse_status') {
              // Muse connection status update
              console.log('[HEADLESS] Muse status:', message.connected ?
                `Connected to ${message.device_name}` : 'Disconnected');

              if (mounted) {
                setStatus(prev => ({
                  ...prev,
                  museConnected: message.connected,
                  deviceName: message.device_name
                }));
              }

              // Register/update device in Redux store
              if (message.connected && message.device_name) {
                dispatch({
                  type: 'devices/create',
                  payload: {
                    id: message.device_name,
                    metadata: {
                      device: 'Muse',
                      connected: true,
                      id: message.device_name,
                      sampling_rate: {
                        EEG: 256,
                        'Band Powers': 10
                      },
                      type: 'headless'
                    }
                  }
                });
              }
            }
            else if (message.type === 'band_powers') {
              // Band power data - dispatch to Redux store
              const deviceId = status.deviceName || 'Muse-Headless';

              dispatch({
                type: 'devices/streamUpdate',
                payload: {
                  id: deviceId,
                  data: message.data,
                  modality: 'Band Powers'
                }
              });
            }
          } catch (err) {
            console.error('[HEADLESS] Message parse error:', err);
          }
        };
      } catch (err) {
        console.error('[HEADLESS] Connection error:', err);
        if (mounted) {
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
        }
      }
    };

    // Start connection
    connect();

    // Cleanup
    return () => {
      mounted = false;
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [dispatch]);

  // Notify parent of status changes
  useEffect(() => {
    if (onStatusChange) {
      onStatusChange(status);
    }
  }, [status, onStatusChange]);

  // This component doesn't render anything
  return null;
}

export default HeadlessMuseReceiver;
