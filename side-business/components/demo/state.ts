"use client";

/**
 * デモの状態。最初はサンプル（サーバーの HTML と同じ）で描き、画面が開いてからこの端末の保存を読む。
 * 保存が使えなくてもメモリの中だけで動き続ける（storageOk が false になる）。
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { sampleData } from "@/lib/payroll/sample";
import type { Adjustment, CompanySettings, Driver, MonthData, Project, WorkRow } from "@/lib/payroll/types";
import type { Requester } from "@/lib/payroll/zengin";
import { loadMonthData, loadRequester, MONTH_KEY, REQUESTER_KEY, sampleRequester, writeStored } from "./persist";
import { demoReducer, type PasteMode } from "./reducer";

export type DemoActions = {
  setSettings: (patch: Partial<CompanySettings>) => void;
  setMonth: (month: string) => void;
  upsertDriver: (driver: Driver) => void;
  removeDriver: (id: string) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setQty: (driverId: string, projectId: string, qty: number) => void;
  applyPaste: (rows: WorkRow[], mode: PasteMode) => void;
  addAdjustment: (adjustment: Adjustment) => void;
  removeAdjustment: (index: number) => void;
  reset: () => void;
};

export function useDemoState(): { data: MonthData; ready: boolean; storageOk: boolean } & DemoActions {
  const [data, dispatch] = useReducer(demoReducer, undefined, () => sampleData());
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    const stored = loadMonthData();
    if (stored) dispatch({ type: "load", data: stored });
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) setStorageOk(writeStored(MONTH_KEY, data));
  }, [data, ready]);

  const actions = useMemo<DemoActions>(
    () => ({
      setSettings: (patch) => dispatch({ type: "setSettings", patch }),
      setMonth: (month) => dispatch({ type: "setMonth", month }),
      upsertDriver: (driver) => dispatch({ type: "upsertDriver", driver }),
      removeDriver: (id) => dispatch({ type: "removeDriver", id }),
      upsertProject: (project) => dispatch({ type: "upsertProject", project }),
      removeProject: (id) => dispatch({ type: "removeProject", id }),
      setQty: (driverId, projectId, qty) => dispatch({ type: "setQty", driverId, projectId, qty }),
      applyPaste: (rows, mode) => dispatch({ type: "applyPaste", rows, mode }),
      addAdjustment: (adjustment) => dispatch({ type: "addAdjustment", adjustment }),
      removeAdjustment: (index) => dispatch({ type: "removeAdjustment", index }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [],
  );

  return { data, ready, storageOk, ...actions };
}

/** 振込依頼人（会社の口座）。支払明細のデータとは別のキーに保存する */
export function useRequesterState(): {
  requester: Requester;
  setRequester: (patch: Partial<Requester>) => void;
  resetRequester: () => void;
} {
  const [requester, setState] = useState<Requester>(() => sampleRequester());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = loadRequester();
    if (stored) setState(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) writeStored(REQUESTER_KEY, requester);
  }, [requester, ready]);

  const setRequester = useCallback((patch: Partial<Requester>) => setState((r) => ({ ...r, ...patch })), []);
  const resetRequester = useCallback(() => setState(sampleRequester()), []);
  return { requester, setRequester, resetRequester };
}
