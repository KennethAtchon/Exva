import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { queryClient } from "./lib/query-client";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element '#root' not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
