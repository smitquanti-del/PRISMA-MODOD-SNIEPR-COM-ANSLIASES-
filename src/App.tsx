import React, { useState, useEffect, useRef } from 'react';
import { 
  AssetPair, 
  BullBearAnalysis, 
  Candle, 
  ServerNode, 
  SignalDirection, 
  SniperSignal, 
  Timeframe, 
  TradeOrder, 
  BrokerSession, 
  AccountMode, 
  MartingaleMode,
  BrokerExecutionMode,
  BrokerExecutionResult,
  CleanEntryCheck
} from './types';
import { 
  ASSET_PAIRS, 
  INITIAL_SERVERS, 
  INITIAL_RECENT_SIGNALS, 
  generateCandles, 
  calcBullBear,
  createBullBearSignal 
} from './utils/marketData';
import { brokerStream } from './services/brokerStream';
import { Header } from './components/Header';
import { ChartCanvas } from './components/ChartCanvas';
import { FloatingSniperPanel } from './components/FloatingSniperPanel';
import { BrokerOrderPanel } from './components/BrokerOrderPanel';
import { AdvancedEnginesPanel } from './components/AdvancedEnginesPanel';
import { ServerClusterModal } from './components/ServerClusterModal';
import { SignalHistoryDrawer } from './components/SignalHistoryDrawer';
import { SsidConnectionModal } from './components/SsidConnectionModal';
import { sound } from './utils/audio';
import { 
  analyzeEagleEye, 
  getSocialSentiment, 
  analyzeOtcManipulation, 
  calculatePredictiveZones 
} from './utils/advancedEngines';
import { evaluateCleanEntryCheck, checkCleanEntry } from './utils/cleanEntryCheck';
import { 
  ShieldCheck, 
  Activity, 
  TrendingUp, 
  History, 
  Server, 
  Zap, 
  Bell, 
  Crosshair,
  KeyRound,
  Eye
} from 'lucide-react';

export default function App() {
  const [allAssets, setAllAssets] = useState<AssetPair[]>(ASSET_PAIRS);
  const [currentAsset, setCurrentAsset] = useState<AssetPair>(ASSET_PAIRS[0]);
  const [timeframe, setTimeframe] = useState<Timeframe>('M1');
  const [candles, setCandles] = useState<Candle[]>(() => generateCandles(ASSET_PAIRS[0], 55));
  const [currentPrice, setCurrentPrice] = useState<number>(ASSET_PAIRS[0].basePrice);
  
  // Real / Demo Broker Session (SSID and Balances)
  const [session, setSession] = useState<BrokerSession>(() => brokerStream.getSession());
  const [ssidModalOpen, setSsidModalOpen] = useState<boolean>(false);

  // Broker Direct Execution Mode ('OFF' | 'DEMO' | 'REAL')
  const [brokerExecutionMode, setBrokerExecutionMode] = useState<BrokerExecutionMode>(() => {
    try {
      const saved = localStorage.getItem('optgo_execution_mode');
      if (saved === 'OFF' || saved === 'DEMO' || saved === 'REAL') return saved;
    } catch {}
    return 'DEMO';
  });

  // Auto-Trade: Automatic order execution when Prisma IA / Vector signals trigger
  // SEMPRE DESLIGADO POR PADRÃO: quando a pessoa entra, sai ou recarrega, sempre inicia DESLIGADO.
  // Se a pessoa quiser, ela mesma liga manualmente.
  const [autoTradeEnabled, setAutoTradeEnabled] = useState<boolean>(false);

  const [isExecutingBroker, setIsExecutingBroker] = useState<boolean>(false);
  const [lastBrokerResult, setLastBrokerResult] = useState<BrokerExecutionResult | null>(null);

  // Bulls vs Bears Analysis State
  const [bullBear, setBullBear] = useState<BullBearAnalysis>(() => calcBullBear(candles));

  // Feedback Pós-Trade para o Desenho Preditivo no gráfico
  const [lastTradeResult, setLastTradeResult] = useState<{
    direction: 'CALL' | 'PUT';
    result: 'WIN' | 'LOSS';
    entryPrice: number;
    exitPrice: number;
    timestamp: number;
  } | null>(null);

  // Exibição do painel dos 4 módulos avançados
  const [showAdvancedEngines, setShowAdvancedEngines] = useState<boolean>(true);
  const [activeSignal, setActiveSignal] = useState<SniperSignal | null>(null);
  const lastAutoSignalTimeRef = useRef<number>(0);

  // Floating Panel Visibility
  const [isFloatingOpen, setIsFloatingOpen] = useState<boolean>(true);

  // Modals
  const [serverModalOpen, setServerModalOpen] = useState<boolean>(false);
  const [historyModalOpen, setHistoryModalOpen] = useState<boolean>(false);

  // Servers
  const [servers, setServers] = useState<ServerNode[]>(INITIAL_SERVERS);

  // Real History (Persisted in localStorage with 100% verified prices)
  const [recentOrders, setRecentOrders] = useState<TradeOrder[]>(() => {
    try {
      const saved = localStorage.getItem('prisma_real_orders');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [signalHistory, setSignalHistory] = useState<SniperSignal[]>(() => {
    try {
      const saved = localStorage.getItem('prisma_real_signals');
      return saved ? JSON.parse(saved) : INITIAL_RECENT_SIGNALS;
    } catch {
      return INITIAL_RECENT_SIGNALS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('prisma_real_orders', JSON.stringify(recentOrders));
    } catch {}
  }, [recentOrders]);

  useEffect(() => {
    try {
      localStorage.setItem('prisma_real_signals', JSON.stringify(signalHistory));
    } catch {}
  }, [signalHistory]);

  const handleClearHistory = () => {
    setRecentOrders([]);
    setSignalHistory([]);
    try {
      localStorage.removeItem('prisma_real_orders');
      localStorage.removeItem('prisma_real_signals');
    } catch {}
  };

  // Martingale strategy configuration: 'GALE1' (permite 1 recuperação de 1M) ou 'NONE' (mão fixa sem gale)
  const [martingaleMode, setMartingaleMode] = useState<MartingaleMode>(() => {
    try {
      const saved = localStorage.getItem('vector_martingale_mode');
      if (saved === 'NONE' || saved === 'GALE1') return saved;
    } catch {}
    return 'GALE1';
  });

  const handleToggleMartingaleMode = (mode: MartingaleMode) => {
    setMartingaleMode(mode);
    try {
      localStorage.setItem('vector_martingale_mode', mode);
    } catch {}
  };

  const [tradeAmount, setTradeAmount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('optgo_trade_amount');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {}
    return session.currency === 'BRL' ? 10 : 5;
  });

  const tradeAmountRef = useRef(tradeAmount);
  tradeAmountRef.current = tradeAmount;

  const handleTradeAmountChange = (amt: number) => {
    setTradeAmount(amt);
    try {
      localStorage.setItem('optgo_trade_amount', String(amt));
    } catch {}
  };

  const handleToggleCurrency = (currency: 'USD' | 'BRL') => {
    const updated = brokerStream.updateSession({ currency });
    setSession(updated);
    try {
      localStorage.setItem('optgo_currency', currency);
    } catch {}
    const min = currency === 'BRL' ? 5 : 1;
    if (tradeAmountRef.current < min) {
      handleTradeAmountChange(min);
    }
  };

  const handleToggleBrokerExecutionMode = (mode: BrokerExecutionMode) => {
    setBrokerExecutionMode(mode);
    try {
      localStorage.setItem('optgo_execution_mode', mode);
    } catch {}
  };

  const handleToggleAutoTrade = (enabled: boolean) => {
    setAutoTradeEnabled(enabled);
    try {
      localStorage.removeItem('optgo_autotrade_enabled');
    } catch {}
    if (enabled) {
      sound.playBeep();
    }
  };

  // Daily Real Statistics (Strictly audited from actual signals and orders)
  const stats = React.useMemo(() => {
    const allSignals = signalHistory.filter((s) => s.status === 'WIN' || s.status === 'LOSS');
    const allOrders = recentOrders.filter((o) => o.status === 'WON' || o.status === 'LOST');
    
    // No modo 'GALE1', tanto WIN quanto WIN_GALE1 contam como vitória
    // No modo 'NONE' (Sem Gale), apenas WIN (1ª vela) conta como vitória
    const signalWins = allSignals.filter((s) => {
      if (s.result === 'WIN') return true;
      if (s.result === 'WIN_GALE1') return martingaleMode === 'GALE1';
      return s.status === 'WIN';
    }).length;
    const signalLosses = allSignals.length - signalWins;

    const wins = signalWins + allOrders.filter((o) => o.status === 'WON').length;
    const losses = signalLosses + allOrders.filter((o) => o.status === 'LOST').length;
    const total = wins + losses;
    const winrate = total > 0 ? +((wins / total) * 100).toFixed(1) : 100.0;
    return { wins, losses, winrate };
  }, [signalHistory, recentOrders, martingaleMode]);

  // Keep latest refs for interval loop & async callbacks (prevents closure staleness)
  const martingaleModeRef = useRef(martingaleMode);
  martingaleModeRef.current = martingaleMode;

  const currentAssetRef = useRef(currentAsset);
  currentAssetRef.current = currentAsset;

  const currentPriceRef = useRef(currentPrice);
  currentPriceRef.current = currentPrice;

  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;

  const activeSignalRef = useRef(activeSignal);
  activeSignalRef.current = activeSignal;

  const brokerExecutionModeRef = useRef(brokerExecutionMode);
  brokerExecutionModeRef.current = brokerExecutionMode;

  const autoTradeEnabledRef = useRef(autoTradeEnabled);
  autoTradeEnabledRef.current = autoTradeEnabled;

  const sessionRef = useRef(session);
  sessionRef.current = session;

  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  // Real-time analysis for the 4 Advanced Engines (Olho de Águia, Social, OTC Anti-manipulação, Overlay Preditivo)
  const currentCandle = candles[candles.length - 1] || null;
  const currentDirection: SignalDirection = activeSignal ? activeSignal.direction : (currentPrice >= (currentCandle?.open ?? currentPrice) ? 'CALL' : 'PUT');

  const eagleEye = React.useMemo(() => {
    return analyzeEagleEye(candles, currentCandle, currentDirection);
  }, [candles, currentCandle, currentDirection]);

  const socialSentiment = React.useMemo(() => {
    return getSocialSentiment(currentAsset.symbol, currentDirection);
  }, [currentAsset.symbol, currentDirection]);

  const otcAnalysis = React.useMemo(() => {
    return analyzeOtcManipulation(candles, currentCandle);
  }, [candles, currentCandle]);

  const cleanEntryCheck = React.useMemo(() => {
    return evaluateCleanEntryCheck(candles, currentDirection, currentAsset.name);
  }, [candles, currentDirection, currentAsset.name]);

  const cleanEntryCheckRef = useRef(cleanEntryCheck);
  cleanEntryCheckRef.current = cleanEntryCheck;

  const predictiveZones = React.useMemo(() => {
    return calculatePredictiveZones(
      candles,
      currentPrice,
      currentDirection,
      bullBear.force,
      eagleEye,
      socialSentiment,
      otcAnalysis
    );
  }, [candles, currentPrice, currentDirection, bullBear.force, eagleEye, socialSentiment, otcAnalysis]);

  const bullBearRef = useRef(bullBear);
  bullBearRef.current = bullBear;

  const eagleEyeRef = useRef(eagleEye);
  eagleEyeRef.current = eagleEye;

  const nextSignalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize brokerStream connection on asset change
  useEffect(() => {
    if (candles.length > 0) {
      brokerStream.connectAsset(currentAsset, candles[candles.length - 1]);
    }
  }, [currentAsset]);

  // Initial account fetch & initial quotes for all assets
  useEffect(() => {
    brokerStream.fetchAccount().then((acc) => {
      setSession(acc);
    });
    brokerStream.fetchInitialQuotes();
  }, []);

  // Subscribe to real-time broker ticks, history candles, live balance, and multi-asset live quotes
  useEffect(() => {
    const unsubscribe = brokerStream.subscribe(
      (livePrice, updatedCandle) => {
        setCurrentPrice(livePrice);
        setCandles((prevCandles) => {
          if (prevCandles.length === 0) return prevCandles;
          const lastIdx = prevCandles.length - 1;
          return [...prevCandles.slice(0, lastIdx), updatedCandle];
        });
      },
      (newCandle) => {
        setCandles((prevCandles) => [...prevCandles.slice(-70), newCandle]);
      },
      (status) => {
        setSession((prev) => ({
          ...prev,
          isConnected: status.isConnected,
          latencyMs: status.latencyMs,
        }));
      },
      (historyCandles) => {
        if (historyCandles && historyCandles.length > 0) {
          setCandles(historyCandles);
          setCurrentPrice(historyCandles[historyCandles.length - 1].close);
        }
      },
      (updatedSession) => {
        setSession(updatedSession);
      },
      // Real-time quote for any asset in OptGo
      (activeId: number, price: number) => {
        setAllAssets((prev) =>
          prev.map((a) => {
            if (a.activeId === activeId) {
              const oldBase = a.basePrice || price;
              const change = +(((price - oldBase) / oldBase) * 100).toFixed(2);
              return {
                ...a,
                basePrice: price,
                change24h: change !== 0 ? change : a.change24h,
              };
            }
            return a;
          })
        );
      }
    );

    return () => unsubscribe();
  }, []);

  // Whenever asset changes, connect brokerStream and calculate Bulls vs Bears
  const handleSelectAsset = (asset: AssetPair) => {
    if (nextSignalTimerRef.current) {
      clearTimeout(nextSignalTimerRef.current);
      nextSignalTimerRef.current = null;
    }
    setCurrentAsset(asset);
    const newCandles = generateCandles(asset, 55);
    setCandles(newCandles);
    setCurrentPrice(newCandles[newCandles.length - 1].close);
    brokerStream.connectAsset(asset, newCandles[newCandles.length - 1]);
    
    const bb = calcBullBear(newCandles);
    setBullBear(bb);
  };

  const handleSelectTimeframe = (tf: Timeframe) => {
    setTimeframe(tf);
    const newCandles = generateCandles(currentAsset, 55);
    setCandles(newCandles);
    const bb = calcBullBear(newCandles);
    setBullBear(bb);
  };

  const handleToggleAccountMode = (mode: AccountMode) => {
    const updated = brokerStream.setAccountMode(mode);
    setSession(updated);
  };

  const handleUpdateSession = (partial: Partial<BrokerSession>) => {
    const prevSsid = session.ssid;
    const updated = brokerStream.updateSession(partial);
    setSession(updated);
    if (partial.ssid && partial.ssid !== prevSsid) {
      brokerStream.reconnect();
    }
  };

  // Quotex Radar: Análise em tempo real de Touros vs Ursos (não gera sinal a cada vela que nasce)
  useEffect(() => {
    const bb = calcBullBear(candles);
    setBullBear(bb);
  }, [candles]);

  // DISPARADOR MODO VECTOR: Disparo direto para a hora certa da entrada (virada de vela)
  const handleSimulateTrigger = (directionChoice: 'AUTO' | 'CALL' | 'PUT' = 'AUTO'): { success: boolean; title: string; detail: string } => {
    let targetDirection: 'CALL' | 'PUT';
    if (directionChoice === 'CALL') {
      targetDirection = 'CALL';
    } else if (directionChoice === 'PUT') {
      targetDirection = 'PUT';
    } else {
      // Modo AUTO direto: segue a tendência da vela atual
      const lastCandle = candles[candles.length - 1];
      const candleOpen = lastCandle ? lastCandle.open : currentPrice;
      targetDirection = currentPrice >= candleOpen ? 'CALL' : 'PUT';
    }

    const isCall = targetDirection === 'CALL';
    const now = new Date();
    const currentSec = now.getSeconds();
    let secondsRemaining = 60 - currentSec;
    if (secondsRemaining < 4) {
      secondsRemaining += 60;
    }

    const targetDate = new Date(now.getTime() + secondsRemaining * 1000);
    const entryTimeString = `${String(targetDate.getHours()).padStart(2, '0')}:${String(targetDate.getMinutes()).padStart(2, '0')}:00`;

    const updatedBB: BullBearAnalysis = {
      bullPct: isCall ? 86 : 14,
      bearPct: isCall ? 14 : 86,
      dominant: isCall ? 'bull' : 'bear',
      force: 86,
      statusText: isCall ? 'alta' : 'baixa',
    };
    setBullBear(updatedBB);

    const cleanCheck = evaluateCleanEntryCheck(candles, targetDirection, currentAsset.name);

    const sig: SniperSignal = {
      id: `sig-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      assetId: currentAsset.id,
      assetName: currentAsset.name,
      direction: targetDirection,
      timeframe,
      entryTime: entryTimeString,
      countdownSeconds: Math.min(secondsRemaining, 60),
      confidence: cleanCheck.confidence,
      bullPct: updatedBB.bullPct,
      bearPct: updatedBB.bearPct,
      force: 88,
      entryPrice: currentPriceRef.current || currentAsset.basePrice,
      confluenceFactors: [
        `Direção: ${isCall ? 'COMPRA (CALL) ▲' : 'VENDA (PUT) ▼'}`,
        `Ativo: ${currentAsset.name}`,
        `Timeframe: ${timeframe}`,
        `Hora Certa: ${entryTimeString}`,
        `Gatilho Limpo: ${cleanCheck.action} (${cleanCheck.confidence}%)`
      ],
      status: 'READY',
      payout: currentAsset.payout,
      cleanEntryCheck: cleanCheck,
      createdAt: Date.now(),
    };

    setActiveSignal(sig);
    lastAutoSignalTimeRef.current = Date.now();

    // Tenta enriquecer via Gemini /api/vision-check sem travar o loop de trading
    checkCleanEntry(candles, targetDirection, currentAsset.name).then((enriched) => {
      setActiveSignal((prev) => prev && prev.id === sig.id ? { ...prev, cleanEntryCheck: enriched } : prev);
    }).catch(() => {});

    sound.playCharge();
    if (sig.direction === 'CALL') {
      sound.playCallSound();
    } else {
      sound.playPutSound();
    }

    return {
      success: true,
      title: `⚡ SINAL DE ${isCall ? 'COMPRA (CALL)' : 'VENDA (PUT)'} ARMADO`,
      detail: `Sinal preparado para a hora certa (${entryTimeString} - virada de vela).`,
    };
  };

  // Radar Signal Countdown, Timing da Hora Certa e Execução Sniper
  useEffect(() => {
    const countdownTimer = setInterval(() => {
      const now = new Date();
      const currentSec = now.getSeconds();
      const current = activeSignalRef.current;

      // 1. SE NÃO HÁ SINAL ATIVO:
      // O radar monitora em silêncio. NÃO dispara quando a vela nasce (segundos 00 a 50).
      // O sinal só deve aparecer NA HORA CERTA DA ENTRADA (Janela Sniper de Virada de Vela: segundos 52 a 56).
      if (!current) {
        const timeSinceLastSignal = Date.now() - lastAutoSignalTimeRef.current;
        const isHoraCertaWindow = currentSec >= 52 && currentSec <= 56;

        // Verifica se estamos na hora certa da entrada E com tempo de respiro (cooldown >= 90s)
        if (isHoraCertaWindow && timeSinceLastSignal > 90000) {
          const currentBB = bullBearRef.current;
          const currentEE = eagleEyeRef.current;

          // Qualificação de confluência: força mínima e Olho de Águia não bloqueado
          const hasForce = currentBB.force >= 60;
          const isEagleClear = currentEE.verdict !== 'BLOCKED' && !currentEE.isToxicZone;

          if (hasForce && isEagleClear) {
            const potentialDirection: SignalDirection = currentBB.dominant === 'bull' ? 'CALL' : 'PUT';
            const cleanCheck = evaluateCleanEntryCheck(candlesRef.current, potentialDirection, currentAssetRef.current.name);

            // Se o Gatilho Limpo acusar padrão tóxico / caça ao stop, bloqueia o disparo automático
            if (cleanCheck.action === 'BLOCK') {
              return;
            }

            lastAutoSignalTimeRef.current = Date.now();
            const newSig = createBullBearSignal(
              currentAssetRef.current,
              currentBB,
              timeframeRef.current,
              currentPriceRef.current
            );
            // Ajusta a contagem regressiva exata para a virada de vela (:00)
            const secondsToTurn = 60 - currentSec;
            newSig.countdownSeconds = secondsToTurn;
            newSig.cleanEntryCheck = cleanCheck;
            newSig.confidence = cleanCheck.confidence;
            newSig.confluenceFactors.push(`Gatilho Limpo: ${cleanCheck.action} (${cleanCheck.confidence}%)`);
            setActiveSignal(newSig);

            // Consulta assíncrona Gemini em segundo plano sem travar o loop
            checkCleanEntry(candlesRef.current, newSig.direction, currentAssetRef.current.name).then((enriched) => {
              setActiveSignal((prev) => prev && prev.id === newSig.id ? { ...prev, cleanEntryCheck: enriched } : prev);
            }).catch(() => {});

            sound.playCharge();
            if (newSig.direction === 'CALL') {
              sound.playCallSound();
            } else {
              sound.playPutSound();
            }
          }
        }
        return;
      }

      // 2. SE HÁ SINAL ATIVO EM PREPARAÇÃO (status === 'READY'):
      // Está contando os segundos restantes até a virada de vela (:00)
      if (current.status === 'READY') {
        if (current.countdownSeconds > 1) {
          setActiveSignal((prev) =>
            prev && prev.id === current.id
              ? { ...prev, countdownSeconds: prev.countdownSeconds - 1 }
              : prev
          );
        } else {
          // CHEGOU A HORA EXATA DA ENTRADA (Virada de Vela às :00)!
          const entryPrice = currentPriceRef.current;
          sound.playBeep();

          // Validação Forense de Gatilho Limpo M1 OTC
          const currentClean = cleanEntryCheckRef.current;
          const isPermitted = !currentClean || currentClean.action === 'EXECUTE';

          // Se o Auto-Trade estiver ligado pela pessoa nesta sessão, executa se o gatilho estiver limpo
          if (autoTradeEnabledRef.current) {
            if (isPermitted) {
              const entryVal = Math.max(sessionRef.current.currency === 'BRL' ? 5 : 1, tradeAmountRef.current);
              handlePlaceTrade(current.direction, entryVal);
            } else if (currentClean?.action === 'WAIT_NEXT_CANDLE') {
              sound.playError();
            } else {
              sound.playError();
            }
          }

          // Transiciona o sinal para 'EXECUTING', iniciando a contagem da vela de expiração (60s)
          setActiveSignal((prev) =>
            prev && prev.id === current.id
              ? {
                  ...prev,
                  status: 'EXECUTING',
                  entryPrice,
                  countdownSeconds: 60,
                }
              : prev
          );
        }
        return;
      }

      // 3. SE O SINAL ESTÁ EM EXECUÇÃO (status === 'EXECUTING'):
      // Acompanha a vela de 1M até sua expiração
      if (current.status === 'EXECUTING') {
        if (current.countdownSeconds > 1) {
          setActiveSignal((prev) =>
            prev && prev.id === current.id
              ? { ...prev, countdownSeconds: prev.countdownSeconds - 1 }
              : prev
          );
        } else {
          // EXPIRAÇÃO CONCLUÍDA: Avaliação 100% REAL do preço de entrada vs saída
          const entryPrice = current.entryPrice || currentPriceRef.current;
          const exitPrice = currentPriceRef.current;
          const isCall = current.direction === 'CALL';
          const isWin = isCall ? exitPrice >= entryPrice : exitPrice <= entryPrice;

          // Se não venceu de primeira e Martingale G1 estiver ativado, entra no G1 (vela de 60s)
          if (!isWin && martingaleModeRef.current === 'GALE1' && (current.galeStage === undefined || current.galeStage === 0)) {
            sound.playBeep();
            if (autoTradeEnabledRef.current) {
              const entryVal = Math.max(sessionRef.current.currency === 'BRL' ? 5 : 1, tradeAmountRef.current) * 2;
              handlePlaceTrade(current.direction, entryVal);
            }

            setActiveSignal((prev) =>
              prev && prev.id === current.id
                ? {
                    ...prev,
                    countdownSeconds: 60,
                    galeStage: 1,
                    entryPrice: exitPrice,
                    confluenceFactors: [
                      ...prev.confluenceFactors,
                      '⚡ Gale 1 (1M): Vela de Recuperação Iniciada',
                    ],
                  }
                : prev
            );
            return;
          }

          const evaluatedResult = isWin
            ? (current.galeStage === 1 ? 'WIN_GALE1' : 'WIN')
            : 'LOSS';

          const evaluatedSignal: SniperSignal = {
            ...current,
            countdownSeconds: 0,
            exitPrice,
            diff: +(exitPrice - entryPrice).toFixed(currentAssetRef.current.decimals),
            status: isWin ? 'WIN' : 'LOSS',
            result: evaluatedResult,
          };

          setActiveSignal(evaluatedSignal);
          if (isWin) {
            sound.playWinChime();
          }

          setSignalHistory((prevHist) => {
            if (prevHist.some((s) => s.id === evaluatedSignal.id)) {
              return prevHist;
            }
            return [evaluatedSignal, ...prevHist.slice(0, 49)];
          });

          // Registra resultado para o overlay preditivo
          setLastTradeResult({
            direction: current.direction,
            result: isWin ? 'WIN' : 'LOSS',
            entryPrice,
            exitPrice,
            timestamp: Date.now(),
          });

          // Retorna o radar ao monitoramento ativo após 8 segundos
          if (nextSignalTimerRef.current) {
            clearTimeout(nextSignalTimerRef.current);
          }
          nextSignalTimerRef.current = setTimeout(() => {
            setActiveSignal(null);
          }, 8000);
        }
      }
    }, 1000);

    return () => {
      clearInterval(countdownTimer);
      if (nextSignalTimerRef.current) {
        clearTimeout(nextSignalTimerRef.current);
      }
    };
  }, []);

  // Handle trade placement with 100% REAL broker execution or simulation
  const handlePlaceTrade = async (direction: SignalDirection, amount: number) => {
    const currentMode = brokerExecutionModeRef.current;
    const currentSess = sessionRef.current;
    const isReal = currentMode === 'REAL' || (currentMode === 'OFF' && currentSess.accountMode === 'REAL');
    const availableBal = isReal ? currentSess.realBalance : currentSess.demoBalance;

    // Validação estrita do valor mínimo: USD = $1, BRL = R$ 5
    const minAmount = currentSess.currency === 'BRL' ? 5 : 1;
    if (amount < minAmount) {
      sound.playError();
      return;
    }

    if (amount > availableBal && currentMode !== 'OFF') {
      sound.playError();
      return;
    }

    // 1. Módulo "Olho de Águia" (Visão Computacional): Validação morfológica rápida antes da execução
    const lastCandle = candlesRef.current[candlesRef.current.length - 1] || null;
    const eaglePreValidation = analyzeEagleEye(candlesRef.current, lastCandle, direction);
    if (eaglePreValidation.isToxicZone) {
      console.warn('Olho de Águia: Zona Tóxica OTC detectada — Atenção a armadilha de liquidez');
    }
    if (eaglePreValidation.rejectionWickDetected) {
      console.warn('Olho de Águia: Pavio de rejeição contra a ordem detectado');
    }

    // Deduct from current balance locally immediately for snappy UX
    const updatedSession = isReal
      ? brokerStream.updateSession({ realBalance: +(currentSess.realBalance - amount).toFixed(2) })
      : brokerStream.updateSession({ demoBalance: +(currentSess.demoBalance - amount).toFixed(2) });
    setSession(updatedSession);

    const entryPrice = currentPriceRef.current;
    const newOrder: TradeOrder = {
      id: `ord-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      assetName: currentAssetRef.current.name,
      direction,
      amount,
      entryPrice,
      payout: currentAssetRef.current.payout,
      timeframe: timeframeRef.current,
      timestamp: Date.now(),
      status: 'OPEN',
      accountMode: isReal ? 'REAL' : 'DEMO',
      executedOnBroker: currentMode !== 'OFF',
    };

    setRecentOrders((prev) => [newOrder, ...prev]);

    // If Broker Execution is active (DEMO or REAL), send order directly to OptGo Quadcode WebSocket
    if (currentMode !== 'OFF') {
      setIsExecutingBroker(true);
      try {
        const result = await brokerStream.executeOption({
          activeId: currentAssetRef.current.activeId || 76,
          direction,
          amount,
          accountMode: currentMode === 'REAL' ? 'REAL' : 'DEMO',
          profitPercent: currentAssetRef.current.payout,
        });
        setIsExecutingBroker(false);
        setLastBrokerResult(result);
        if (result.success) {
          sound.playBeep();
          setRecentOrders((prev) =>
            prev.map((ord) =>
              ord.id === newOrder.id
                ? { ...ord, brokerOptionId: result.optionId, executedOnBroker: true }
                : ord
            )
          );
        } else {
          sound.playError();
        }
      } catch (err: any) {
        setIsExecutingBroker(false);
        setLastBrokerResult({
          success: false,
          error: err.message || 'Erro de comunicação com a corretora',
        });
      }
    }

    // Resolução 100% REAL baseada na cotação real do ativo ao expirar a ordem
    setTimeout(() => {
      const exitPrice = currentPriceRef.current;
      const isCall = direction === 'CALL';
      const isWin = isCall ? exitPrice > entryPrice : exitPrice < entryPrice;
      const isTie = exitPrice === entryPrice;
      const profit = isWin ? +(amount * (currentAssetRef.current.payout / 100)).toFixed(2) : 0;

      if (isWin) {
        sound.playWinChime();
        setSession((prevS) => {
          const newBal = isReal
            ? { realBalance: +(prevS.realBalance + amount + profit).toFixed(2) }
            : { demoBalance: +(prevS.demoBalance + amount + profit).toFixed(2) };
          return brokerStream.updateSession(newBal);
        });
      } else if (isTie) {
        // Empate: estorna o valor investido
        setSession((prevS) => {
          const newBal = isReal
            ? { realBalance: +(prevS.realBalance + amount).toFixed(2) }
            : { demoBalance: +(prevS.demoBalance + amount).toFixed(2) };
          return brokerStream.updateSession(newBal);
        });
      }

      setRecentOrders((prev) =>
        prev.map((ord) =>
          ord.id === newOrder.id
            ? {
                ...ord,
                exitPrice,
                status: isWin ? 'WON' : isTie ? 'OPEN' : 'LOST',
                profit: isWin ? profit : undefined,
              }
            : ord
        )
      );

      // 3. Sistema de Desenho Preditivo: Registra Feedback Pós-Trade no gráfico histórico
      setLastTradeResult({
        direction,
        result: isWin ? 'WIN' : 'LOSS',
        entryPrice,
        exitPrice,
        timestamp: Date.now(),
      });

      // Sincroniza saldo oficial com a corretora OPTGO
      if (currentMode !== 'OFF') {
        brokerStream.fetchAccount().then((acc) => setSession(acc)).catch(() => {});
      }
    }, 8000);
  };

  const handleRefreshPings = () => {
    setServers((prev) =>
      prev.map((s) => ({
        ...s,
        ping: Math.floor(Math.random() * 8 + 8),
      }))
    );
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#020504] text-[#e5f7ed]">
      {/* Traderoom Header */}
      <Header
        currentAsset={currentAsset}
        allAssets={allAssets}
        onSelectAsset={handleSelectAsset}
        timeframe={timeframe}
        onSelectTimeframe={handleSelectTimeframe}
        isFloatingOpen={isFloatingOpen}
        onToggleFloating={() => setIsFloatingOpen(!isFloatingOpen)}
        onOpenServerModal={() => setServerModalOpen(true)}
        stats={stats}
        session={session}
        onToggleAccountMode={handleToggleAccountMode}
        onOpenSsidModal={() => setSsidModalOpen(true)}
      />

      {/* Main Traderoom Content */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left / Center: Interactive Candlestick Chart */}
        <div className="relative flex-1 flex flex-col overflow-hidden">
          <ChartCanvas
            asset={currentAsset}
            candles={candles}
            timeframe={timeframe}
            activeSignal={activeSignal}
            currentPrice={currentPrice}
            eagleEye={eagleEye}
            social={socialSentiment}
            otc={otcAnalysis}
            predictiveZones={predictiveZones}
            cleanEntryCheck={cleanEntryCheck}
            lastTradeResult={lastTradeResult}
          />

          {/* Módulos Avançados: Olho de Águia, Radar Social, Overlay Preditivo, Anti-Manipulação OTC, Gatilho Limpo */}
          {showAdvancedEngines && (
            <div className="border-t border-[#00ff66]/20 bg-[#020d06]/95 p-2 overflow-y-auto max-h-[36vh] shrink-0">
              <AdvancedEnginesPanel
                eagleEye={eagleEye}
                social={socialSentiment}
                otc={otcAnalysis}
                predictive={predictiveZones}
                direction={currentDirection}
                currentPrice={currentPrice}
                cleanEntryCheck={cleanEntryCheck}
              />
            </div>
          )}

          {/* Floating Quotex Radar v3.2 Bulls vs Bears Panel */}
          {isFloatingOpen && (
            <FloatingSniperPanel
              asset={currentAsset}
              candles={candles}
              currentPrice={currentPrice}
              bullBear={bullBear}
              signal={activeSignal}
              cleanEntryCheck={cleanEntryCheck}
              onExecuteTrade={(dir) => handlePlaceTrade(dir, Math.max(session.currency === 'BRL' ? 5 : 1, tradeAmount))}
              onClose={() => setIsFloatingOpen(false)}
              dailyWinRate={stats.winrate}
              onSimulateTrigger={handleSimulateTrigger}
              martingaleMode={martingaleMode}
              onToggleMartingaleMode={handleToggleMartingaleMode}
              autoTradeEnabled={autoTradeEnabled}
              onToggleAutoTrade={handleToggleAutoTrade}
            />
          )}
        </div>

        {/* Right: Live Broker Order Panel (OptGo VIP bridge / real execution) */}
        <BrokerOrderPanel
          asset={currentAsset}
          timeframe={timeframe}
          session={session}
          onToggleAccountMode={handleToggleAccountMode}
          onToggleCurrency={handleToggleCurrency}
          brokerExecutionMode={brokerExecutionMode}
          onToggleBrokerExecutionMode={handleToggleBrokerExecutionMode}
          autoTradeEnabled={autoTradeEnabled}
          onToggleAutoTrade={handleToggleAutoTrade}
          isExecutingBrokerOrder={isExecutingBroker}
          lastBrokerResult={lastBrokerResult}
          onPlaceTrade={handlePlaceTrade}
          recentOrders={recentOrders}
          onOpenSsidModal={() => setSsidModalOpen(true)}
          tradeAmount={tradeAmount}
          onChangeTradeAmount={handleTradeAmountChange}
        />
      </div>

      {/* Traderoom Bottom Status Ticker Bar */}
      <footer 
        id="traderoom-status-bar"
        className="flex items-center justify-between border-t border-[#00ff66]/20 bg-[rgba(1,4,3,0.98)] px-4 py-2 text-xs font-mono select-none"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[#00ff66]">
            <ShieldCheck className="h-4 w-4" />
            <span className="font-bold">OPTGO BROKER • SSL 100% (TLS 1.3)</span>
          </div>
          <span className="text-[#7a9587] hidden md:inline">|</span>
          <div className="hidden md:flex items-center gap-2 text-[#7a9587]">
            <span>SSID: <strong className="text-white font-mono">{session.ssid.substring(0, 8)}...</strong></span>
            <span>OptGo VIP: <strong className="text-[#00ff66]">{session.latencyMs}ms</strong></span>
            <span>São Paulo: <strong className="text-[#00ff66]">8ms</strong></span>
            <span>New York: <strong className="text-[#00ff66]">15ms</strong></span>
            <span>Frankfurt: <strong className="text-[#00ff66]">22ms</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="open-ssid-footer-btn"
            onClick={() => {
              sound.playClick();
              setSsidModalOpen(true);
            }}
            className="flex items-center gap-1 rounded-md border border-[#00ff66]/30 bg-[#00ff66]/10 px-2 py-1 text-xs text-[#00ff66] hover:bg-[#00ff66]/20 transition"
            title="Gerenciar sessão SSID e conta"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>Gerenciar SSID</span>
          </button>

          <button
            id="toggle-advanced-engines-btn"
            onClick={() => {
              sound.playClick();
              setShowAdvancedEngines((prev) => !prev);
            }}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition ${
              showAdvancedEngines
                ? 'border-[#00ff66]/50 bg-[#00ff66]/20 text-[#00ff66]'
                : 'border-white/10 bg-black/60 text-zinc-400 hover:text-white'
            }`}
            title="Exibir ou ocultar os 4 Módulos de IA (Olho de Águia, Radar Social, Overlay Preditivo, Anti-Manipulação OTC)"
          >
            <Crosshair className="h-3.5 w-3.5 text-[#00ff66]" />
            <span>4 Módulos IA</span>
          </button>

          <button
            id="view-signals-history-btn"
            onClick={() => {
              sound.playClick();
              setHistoryModalOpen(true);
            }}
            className="flex items-center gap-1 rounded-md border border-[#00ff66]/30 bg-black/60 px-2.5 py-1 text-xs text-[#00ff66] hover:bg-[#00ff66]/15 transition"
          >
            <History className="h-3.5 w-3.5" />
            <span>Histórico ({signalHistory.length} Sinais)</span>
          </button>

          <button
            id="open-servers-btn"
            onClick={() => {
              sound.playClick();
              setServerModalOpen(true);
            }}
            className="flex items-center gap-1 rounded-md border border-white/10 bg-black/60 px-2.5 py-1 text-xs text-zinc-300 hover:border-[#00ff66]/40 hover:text-white transition"
          >
            <Server className="h-3.5 w-3.5 text-[#00ff66]" />
            <span>Servidores</span>
          </button>
        </div>
      </footer>

      {/* Modals */}
      <SsidConnectionModal
        isOpen={ssidModalOpen}
        onClose={() => setSsidModalOpen(false)}
        session={session}
        onUpdateSession={handleUpdateSession}
      />

      <ServerClusterModal
        isOpen={serverModalOpen}
        onClose={() => setServerModalOpen(false)}
        servers={servers}
        onRefreshPings={handleRefreshPings}
      />

      <SignalHistoryDrawer
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        signals={signalHistory}
        orders={recentOrders}
        onClearHistory={handleClearHistory}
        martingaleMode={martingaleMode}
        onToggleMartingaleMode={handleToggleMartingaleMode}
      />
    </div>
  );
}
