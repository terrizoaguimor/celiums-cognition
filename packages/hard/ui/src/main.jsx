import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect, Fragment } from 'react';
/*
 * Copyright 2026 Celiums Solutions LLC
 * Licensed under the Apache License, Version 2.0
 */

// Vite ESM entry. The prototype loaded React + Babel from CDN and dumped
// each component as a global; for production we bundle properly. Each
// JSX file now exports its top-level component(s) and imports from React
// instead of relying on window.React.

import ReactDOM from "react-dom/client";
import "./tokens.css";
import "./app.css";
import { App } from "./app.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  React.createElement(React.StrictMode, null, React.createElement(App)),
);
