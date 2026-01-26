/**
 * KioskView - Full-screen visualization view for headless kiosk operation
 *
 * Features:
 * - No authentication required
 * - Full-screen p5 canvas
 * - Floating Muse connect button
 * - Auto-loads visualization parameters
 * - Streams EEG data to visualization
 */

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, gql } from "@apollo/client";
import { useSelector, useDispatch } from "react-redux";
import { MuseConnectButton } from "./MuseConnectButton";
import { KioskAutoMapper } from "./KioskAutoMapper";
import { fetchCode } from "../visuals/utility/fetch_code";
import { selectParamValues } from "../visuals/utility/selectors";

// GraphQL query for kiosk visualization (works without auth)
const KIOSK_VISUAL = gql`
  query KioskVisual($id: ID!) {
    visual(where: { id: $id }) {
      id
      title
      code {
        url
      }
      parameters
      extensions
    }
  }
`;

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
  },
  loading: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: 'white',
    fontSize: '24px',
    fontFamily: 'system-ui, sans-serif',
  },
  error: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#f44336',
    fontSize: '20px',
    fontFamily: 'system-ui, sans-serif',
    textAlign: 'center',
    padding: '20px',
  },
};

export function KioskView() {
  const { visID } = useParams();
  const dispatch = useDispatch();
  const iframeRef = useRef(null);

  const [code, setCode] = useState(null);
  const [codeLoading, setCodeLoading] = useState(true);

  // Get visualization metadata
  const { loading, error, data } = useQuery(KIOSK_VISUAL, {
    variables: { id: visID },
  });

  const visMetadata = data?.visual;
  const params = useSelector(selectParamValues);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Load parameters into Redux store
  useEffect(() => {
    if (visMetadata?.parameters) {
      console.log('[KIOSK] Loading parameters:', visMetadata.parameters);
      dispatch({ type: "params/load", payload: visMetadata.parameters });
    }
  }, [visMetadata, dispatch]);

  // Fetch visualization code
  useEffect(() => {
    if (visMetadata?.code?.url) {
      console.log('[KIOSK] Fetching code from:', visMetadata.code.url);
      setCodeLoading(true);
      fetchCode(visMetadata.code.url)
        .then((response) => {
          console.log('[KIOSK] Code loaded successfully');
          setCode(response);
          setCodeLoading(false);
        })
        .catch((err) => {
          console.error('[KIOSK] Failed to load code:', err);
          setCodeLoading(false);
        });
    }
  }, [visMetadata]);

  // Update iframe with visualization code
  useEffect(() => {
    if (!code || !iframeRef.current) return;

    const additionalPackages = visMetadata?.extensions || [];
    const scripts = additionalPackages
      .map((item) => `<script src="${item.url}"></script>`)
      .join("\n");

    // Scripts for receiving data from parent
    const receiveValues = `
      var data = ${JSON.stringify(params)};
      window.addEventListener("message", (event) => {
        if (event.origin === "${window.location.origin}") {
          try {
            data = JSON.parse(event.data);
          } catch(e) {}
        }
      });
    `;

    const errorScript = `
      window.addEventListener("error", ({ error }) => {
        console.error('[P5 Error]', error?.message || error);
      });
    `;

    const source = `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="${window.location.origin}/lib/p5.min.js"></script>
        <script src="${window.location.origin}/lib/Tone.min.js"></script>
        ${scripts}
        <style>
          body {
            margin: 0;
            padding: 0;
            height: 100vh;
            width: 100vw;
            overflow: hidden;
            background: #000;
          }
        </style>
      </head>
      <body>
        <div id="app"></div>
        <script>${errorScript}</script>
        <script>${receiveValues}</script>
        <script>${code}</script>
      </body>
      </html>
    `;

    iframeRef.current.srcdoc = source;
    console.log('[KIOSK] Visualization loaded');
  }, [code, visMetadata?.extensions]);

  // Stream parameter updates to iframe
  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify(paramsRef.current),
        '*'
      );
    }
  }, [params]);

  // Loading state
  if (loading || codeLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading visualization...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <div>Failed to load visualization</div>
          <div style={{ fontSize: '14px', marginTop: '10px', opacity: 0.7 }}>
            {error.message}
          </div>
        </div>
      </div>
    );
  }

  // Visualization not found
  if (!visMetadata) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <div>Visualization not found</div>
          <div style={{ fontSize: '14px', marginTop: '10px', opacity: 0.7 }}>
            ID: {visID}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Auto-map Muse data to visualization parameters */}
      <KioskAutoMapper />

      {/* Muse connect button overlay - handles auto-connect on boot */}
      <MuseConnectButton />

      {/* Full-screen visualization iframe */}
      <iframe
        ref={iframeRef}
        title="kiosk-visualization"
        style={styles.iframe}
        sandbox="allow-same-origin allow-scripts"
      />
    </div>
  );
}

export default KioskView;
