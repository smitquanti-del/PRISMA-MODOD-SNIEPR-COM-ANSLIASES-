import React, { useRef, useEffect, useState } from 'react';
import { AssetPair, Candle, SniperSignal, Timeframe, EagleEyeAnalysis, SocialSentiment, OtcManipulationAnalysis, PredictiveZones, CleanEntryCheck } from '../types';
import { ZoomIn, ZoomOut, ShieldCheck, Users, Crosshair, Zap } from 'lucide-react';

interface ChartCanvasProps {
  asset: AssetPair;
  candles: Candle[];
  timeframe: Timeframe;
  activeSignal: SniperSignal | null;
  currentPrice: number;
  eagleEye?: EagleEyeAnalysis;
  social?: SocialSentiment;
  otc?: OtcManipulationAnalysis;
  predictiveZones?: PredictiveZones;
  cleanEntryCheck?: CleanEntryCheck;
  lastTradeResult?: {
    direction: 'CALL' | 'PUT';
    result: 'WIN' | 'LOSS';
    entryPrice: number;
    exitPrice: number;
    timestamp: number;
  } | null;
}

export const ChartCanvas: React.FC<ChartCanvasProps> = ({
  asset,
  candles,
  timeframe,
  activeSignal,
  currentPrice,
  eagleEye,
  social,
  otc,
  predictiveZones,
  cleanEntryCheck,
  lastTradeResult,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverData, setHoverData] = useState<{
    candle: Candle;
    x: number;
    y: number;
  } | null>(null);

  const [visibleCount, setVisibleCount] = useState(48);
  const [showPredictiveOverlay, setShowPredictiveOverlay] = useState(true);
  const [candleCountdown, setCandleCountdown] = useState(() => 60 - new Date().getSeconds());

  useEffect(() => {
    const timer = setInterval(() => {
      setCandleCountdown(60 - new Date().getSeconds());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      drawChart();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [candles, currentPrice, visibleCount, showPredictiveOverlay, activeSignal, eagleEye, social, otc, predictiveZones, lastTradeResult]);

  const drawChart = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Dark sleek background
    ctx.fillStyle = '#020504';
    ctx.fillRect(0, 0, width, height);

    // 3. HEATMAP DE PROBABILIDADE PREDITIVA DE FUNDO (Visual Overlay)
    if (showPredictiveOverlay && predictiveZones) {
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      if (predictiveZones.heatmapColor === 'green') {
        grad.addColorStop(0, 'rgba(0, 255, 102, 0.07)');
        grad.addColorStop(0.5, 'rgba(0, 255, 102, 0.02)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (predictiveZones.heatmapColor === 'yellow') {
        grad.addColorStop(0, 'rgba(255, 230, 0, 0.06)');
        grad.addColorStop(0.5, 'rgba(255, 230, 0, 0.02)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else {
        grad.addColorStop(0, 'rgba(255, 51, 85, 0.09)');
        grad.addColorStop(0.5, 'rgba(255, 51, 85, 0.03)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // Subtle tactical grid background
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 255, 102, 0.035)';
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (candles.length === 0) {
      ctx.restore();
      return;
    }

    // Determine slice of candles to show
    const count = Math.min(visibleCount, candles.length);
    const visibleCandles = candles.slice(-count);
    const candleStartIndex = candles.length - count;

    // Price scaling
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVolume = 0;

    for (const c of visibleCandles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.volume > maxVolume) maxVolume = c.volume;
    }

    // Inclui zonas preditivas no autoscaling se visíveis
    if (showPredictiveOverlay && predictiveZones) {
      minPrice = Math.min(minPrice, predictiveZones.stopLossPrice, predictiveZones.takeProfitPrice);
      maxPrice = Math.max(maxPrice, predictiveZones.stopLossPrice, predictiveZones.takeProfitPrice);
    }

    // Add padding to price range
    const pricePadding = (maxPrice - minPrice) * 0.12 || 0.001;
    minPrice -= pricePadding;
    maxPrice += pricePadding;
    const priceRange = maxPrice - minPrice;

    // Layout regions
    const rightMargin = 85;
    const bottomMargin = 25;
    const chartHeight = height - bottomMargin;
    const chartWidth = width - rightMargin;
    const candleSlotWidth = chartWidth / count;
    const candleBodyWidth = Math.max(3, candleSlotWidth * 0.7);

    const getY = (price: number) => {
      return chartHeight - ((price - minPrice) / priceRange) * chartHeight;
    };

    // 3.1 ZONA VISUAL DE FOCO M1 (Gatilho Limpo - Últimas 3-5 Velas)
    if (showPredictiveOverlay && visibleCandles.length >= 3) {
      const focusCount = Math.min(5, visibleCandles.length);
      const focusStartIndex = visibleCandles.length - focusCount;
      const startX = focusStartIndex * candleSlotWidth + (candleSlotWidth - candleBodyWidth) / 2 - 4;
      const endX = chartWidth;
      const boxWidth = Math.max(20, endX - startX);

      const focusCandles = visibleCandles.slice(-focusCount);
      const highVal = Math.max(...focusCandles.map(c => c.high));
      const lowVal = Math.min(...focusCandles.map(c => c.low));
      const boxTop = Math.max(0, getY(highVal) - 6);
      const boxBottom = Math.min(chartHeight, getY(lowVal) + 6);
      const boxHeight = Math.max(16, boxBottom - boxTop);

      const isExecute = cleanEntryCheck?.action === 'EXECUTE' || (!cleanEntryCheck && (!activeSignal || activeSignal.status === 'READY'));
      const isWait = cleanEntryCheck?.action === 'WAIT_NEXT_CANDLE';
      const isBlock = cleanEntryCheck?.action === 'BLOCK';

      const strokeColor = isBlock ? 'rgba(255, 51, 85, 0.5)' : isWait ? 'rgba(250, 204, 21, 0.5)' : 'rgba(0, 255, 102, 0.4)';
      const fillColor = isBlock ? 'rgba(255, 51, 85, 0.04)' : isWait ? 'rgba(250, 204, 21, 0.04)' : 'rgba(0, 255, 102, 0.04)';

      ctx.fillStyle = fillColor;
      ctx.fillRect(startX, boxTop, boxWidth, boxHeight);
      ctx.strokeStyle = strokeColor;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(startX, boxTop, boxWidth, boxHeight);
      ctx.setLineDash([]);

      // Rótulo da Zona de Gatilho Limpo
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.fillStyle = isBlock ? '#ff3355' : isWait ? '#facc15' : '#00ff66';
      ctx.textAlign = 'right';
      const actionText = cleanEntryCheck
        ? `⚡ GATILHO M1: ${cleanEntryCheck.action} (${cleanEntryCheck.confidence}%)`
        : `⚡ FOCO M1: MICRO-ESTRUTURA (3-5 VELAS)`;
      ctx.fillText(actionText, chartWidth - 8, boxTop + 12);
    }

    // Draw Price Levels & Horizontal Guidelines
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillStyle = '#7a9587';
    ctx.textAlign = 'left';
    const priceSteps = 6;
    for (let i = 0; i <= priceSteps; i++) {
      const priceVal = minPrice + (priceRange / priceSteps) * i;
      const y = getY(priceVal);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(chartWidth, y);
      ctx.stroke();

      ctx.fillText(priceVal.toFixed(asset.decimals), chartWidth + 8, y + 3);
    }

    // Draw Candlesticks (Limpo, sem bandas de bollinger, médias ou volume)
    visibleCandles.forEach((c, i) => {
      const x = i * candleSlotWidth + candleSlotWidth / 2;
      const isGreen = c.close >= c.open;
      const color = isGreen ? '#00ff66' : '#ff3355';

      const highY = getY(c.high);
      const lowY = getY(c.low);
      const openY = getY(c.open);
      const closeY = getY(c.close);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(2, Math.abs(closeY - openY));

      ctx.fillStyle = color;
      ctx.fillRect(x - candleBodyWidth / 2, bodyTop, candleBodyWidth, bodyHeight);
    });

    // 3.2 FEEDBACK PÓS-TRADE (Marcador Visual Histórico de Aprendizado)
    if (lastTradeResult) {
      const isWin = lastTradeResult.result === 'WIN';
      const entryY = getY(lastTradeResult.entryPrice);
      ctx.save();
      ctx.strokeStyle = isWin ? '#00ff66' : '#ff3355';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(0, entryY);
      ctx.lineTo(chartWidth, entryY);
      ctx.stroke();

      // Tag de Pós-Trade no gráfico
      ctx.fillStyle = isWin ? 'rgba(0, 255, 102, 0.2)' : 'rgba(255, 51, 85, 0.2)';
      ctx.fillRect(chartWidth - 170, entryY - 10, 160, 20);
      ctx.strokeStyle = isWin ? '#00ff66' : '#ff3355';
      ctx.setLineDash([]);
      ctx.strokeRect(chartWidth - 170, entryY - 10, 160, 20);

      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.fillStyle = isWin ? '#00ff66' : '#ff3355';
      ctx.textAlign = 'center';
      ctx.fillText(
        `ÚLTIMO TRADE: ${isWin ? 'WIN ✅' : 'LOSS ❌'} (${lastTradeResult.direction})`,
        chartWidth - 90,
        entryY + 4
      );
      ctx.restore();
    }

    // Draw Active Sniper Signal Indicator on chart if applicable
    if (activeSignal && activeSignal.assetId === asset.id) {
      const lastCandleX = (visibleCandles.length - 1) * candleSlotWidth + candleSlotWidth / 2;
      const isCall = activeSignal.direction === 'CALL';
      const targetY = isCall ? getY(visibleCandles[visibleCandles.length - 1].low) + 30 : getY(visibleCandles[visibleCandles.length - 1].high) - 30;

      // Draw Sniper Reticle
      ctx.save();
      ctx.strokeStyle = isCall ? '#00ff66' : '#ff3355';
      ctx.fillStyle = isCall ? 'rgba(0, 255, 102, 0.15)' : 'rgba(255, 51, 85, 0.15)';
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(lastCandleX, targetY, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Crosshair lines
      ctx.beginPath();
      ctx.moveTo(lastCandleX - 18, targetY);
      ctx.lineTo(lastCandleX + 18, targetY);
      ctx.moveTo(lastCandleX, targetY - 18);
      ctx.lineTo(lastCandleX, targetY + 18);
      ctx.stroke();

      // Arrow tag
      ctx.font = 'bold 11px JetBrains Mono, monospace';
      ctx.fillStyle = isCall ? '#00ff66' : '#ff3355';
      ctx.textAlign = 'center';
      const text = isCall ? '🎯 SNIPER CALL ⬆' : '🎯 SNIPER PUT ⬇';
      ctx.fillText(text, lastCandleX, isCall ? targetY + 28 : targetY - 22);

      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`IA: ${activeSignal.confidence}%`, lastCandleX, isCall ? targetY + 40 : targetY - 34);

      ctx.restore();
    }

    // Current Price Line & Badge
    const currentPriceY = getY(currentPrice);
    const lastCandle = visibleCandles[visibleCandles.length - 1];
    const isCurrentGreen = lastCandle ? lastCandle.close >= lastCandle.open : true;
    const badgeColor = isCurrentGreen ? '#00ff66' : '#ff3355';

    ctx.strokeStyle = badgeColor;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, currentPriceY);
    ctx.lineTo(chartWidth, currentPriceY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price badge on the right axis
    ctx.fillStyle = badgeColor;
    ctx.fillRect(chartWidth + 4, currentPriceY - 11, rightMargin - 8, 22);
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.fillText(currentPrice.toFixed(asset.decimals), chartWidth + (rightMargin / 2), currentPriceY + 4);

    // Hover crosshair and tooltip
    if (hoverData) {
      const hX = hoverData.x;
      const hY = hoverData.y;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(hX, 0);
      ctx.lineTo(hX, chartHeight);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(0, hY);
      ctx.lineTo(chartWidth, hY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const count = Math.min(visibleCount, candles.length);
    const chartWidth = rect.width - 85;
    const candleSlotWidth = chartWidth / count;

    if (x < chartWidth) {
      const index = Math.floor(x / candleSlotWidth);
      const candleIndex = candles.length - count + index;
      if (candleIndex >= 0 && candleIndex < candles.length) {
        setHoverData({
          candle: candles[candleIndex],
          x,
          y,
        });
      }
    }
  };

  const handleMouseLeave = () => {
    setHoverData(null);
  };

  return (
    <div ref={containerRef} className="relative h-full w-full select-none overflow-hidden bg-[#020504]">
      {/* Chart Top Info Bar */}
      <div className="absolute top-2 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md bg-black/85 px-2.5 py-1 border border-white/10 backdrop-blur-sm">
            <span className="font-extrabold text-white">{asset.name}</span>
            <span className="text-[#00ff66] font-bold">{currentPrice.toFixed(asset.decimals)}</span>
            <span className={`text-[10px] ${asset.change24h >= 0 ? 'text-[#00ff66]' : 'text-rose-400'}`}>
              {asset.change24h >= 0 ? '▲ +' : '▼ '}{asset.change24h}%
            </span>
          </div>

          {/* Live Candle Countdown */}
          <div className="flex items-center gap-1.5 rounded-md bg-black/85 px-2.5 py-1 border border-[#00ff66]/30 backdrop-blur-sm text-[11px] text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-[#00ff66] animate-pulse" />
            <span className="text-[#7a9587]">Vela:</span>
            <strong className="text-[#00ff66] font-extrabold">00:{String(candleCountdown).padStart(2, '0')}s</strong>
          </div>

          {/* 1. MÓDULO OLHO DE ÁGUIA BADGE */}
          {eagleEye && (
            <div
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 border backdrop-blur-sm text-[11px] font-bold transition ${
                eagleEye.verdict === 'CLEAR'
                  ? 'bg-[#00ff66]/10 border-[#00ff66]/40 text-[#00ff66]'
                  : eagleEye.verdict === 'CAUTION'
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                  : 'bg-rose-500/15 border-rose-500/50 text-rose-300 animate-pulse'
              }`}
              title={eagleEye.notes.join(' | ')}
            >
              <Crosshair className="h-3.5 w-3.5 shrink-0" />
              <span>Olho de Águia:</span>
              <span>
                {eagleEye.verdict === 'CLEAR'
                  ? `Seguro (${eagleEye.safetyScore}%)`
                  : eagleEye.verdict === 'CAUTION'
                  ? `Atenção (${eagleEye.safetyScore}%)`
                  : '⛔ ZONA TÓXICA'}
              </span>
            </div>
          )}

          {/* 2. RADAR SOCIAL BADGE */}
          {social && (
            <div
              className={`hidden sm:flex items-center gap-1.5 rounded-md px-2 py-1 border backdrop-blur-sm text-[10px] font-bold ${
                social.divergenceAlert
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                  : 'bg-black/80 border-white/15 text-zinc-300'
              }`}
              title={`Score Multidão: ${social.crowdScore}% Bullish | ${social.bearishScore}% Bearish`}
            >
              <Users className="h-3 w-3 text-cyan-400" />
              <span>Social:</span>
              <span className={social.crowdScore >= 50 ? 'text-[#00ff66]' : 'text-rose-400'}>
                {social.crowdScore}% {social.bias}
              </span>
              {social.divergenceAlert && <span className="text-amber-400 font-black">(! Alerta)</span>}
            </div>
          )}

          {/* 4. FILTRO ANTI-MANIPULAÇÃO OTC BADGE */}
          {otc && (
            <div
              className={`hidden md:flex items-center gap-1.5 rounded-md px-2 py-1 border backdrop-blur-sm text-[10px] font-bold ${
                otc.status === 'ORGANIC'
                  ? 'bg-black/80 border-[#00ff66]/20 text-zinc-300'
                  : otc.status === 'SUSPICIOUS'
                  ? 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                  : 'bg-rose-950/50 border-rose-500/60 text-rose-300 animate-pulse'
              }`}
            >
              <ShieldCheck className="h-3 w-3 text-[#00ff66]" />
              <span>OTC:</span>
              <span className={otc.isSafeToTrade ? 'text-[#00ff66]' : 'text-rose-400'}>
                {otc.status === 'ORGANIC' ? 'Orgânico' : otc.status === 'SUSPICIOUS' ? 'Inconsistente' : 'Stop-Hunt'}
              </span>
            </div>
          )}
        </div>

        {/* Gatilho Limpo M1 Indicator */}
        {cleanEntryCheck && (
          <div
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 border backdrop-blur-sm text-xs ${
              cleanEntryCheck.action === 'EXECUTE'
                ? 'bg-[#00ff66]/10 border-[#00ff66]/30 text-[#00ff66]'
                : cleanEntryCheck.action === 'WAIT_NEXT_CANDLE'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-rose-500/10 border-rose-500/40 text-rose-300'
            }`}
          >
            <Zap className="h-3 w-3" />
            <span className="font-bold">Gatilho M1:</span>
            <strong className="font-black uppercase">{cleanEntryCheck.action}</strong>
            <span className="text-[10px] opacity-80">({cleanEntryCheck.confidence}%)</span>
          </div>
        )}

        {/* Probabilidade Preditiva Unificada */}
        {predictiveZones && !cleanEntryCheck && (
          <div className="flex items-center gap-1.5 rounded-md bg-black/90 px-3 py-1 border border-white/15 backdrop-blur-sm text-xs">
            <span className="text-[#7a9587]">Probabilidade IA:</span>
            <strong
              className={`font-black ${
                predictiveZones.heatmapColor === 'green'
                  ? 'text-[#00ff66]'
                  : predictiveZones.heatmapColor === 'yellow'
                  ? 'text-amber-400'
                  : 'text-rose-500'
              }`}
            >
              {predictiveZones.probabilityScore}%
            </strong>
          </div>
        )}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="block h-full w-full cursor-crosshair"
      />

      {/* Floating Chart Controls */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-[#00ff66]/20 bg-black/80 p-1 backdrop-blur-md">
        <button
          id="zoom-in-btn"
          onClick={() => setVisibleCount((c) => Math.max(20, c - 6))}
          className="p-1.5 text-[#7a9587] hover:text-[#00ff66] transition rounded"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          id="zoom-out-btn"
          onClick={() => setVisibleCount((c) => Math.min(100, c + 6))}
          className="p-1.5 text-[#7a9587] hover:text-[#00ff66] transition rounded"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          id="toggle-predictive-overlay-btn"
          onClick={() => setShowPredictiveOverlay((s) => !s)}
          className={`px-2 py-1 flex items-center gap-1 text-[10px] font-bold transition rounded ${showPredictiveOverlay ? 'bg-[#00ff66]/20 text-[#00ff66] border border-[#00ff66]/40' : 'text-zinc-500'}`}
          title="Alternar Destaque de Micro-Estrutura M1 (Últimas 3-5 Velas)"
        >
          <Crosshair className="h-3.5 w-3.5" />
          <span>Foco M1 (3-5 Velas)</span>
        </button>
      </div>
    </div>
  );
};
