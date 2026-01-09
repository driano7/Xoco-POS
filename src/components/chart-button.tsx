'use client';

import { useCallback, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { toPng } from 'html-to-image';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

interface ChartButtonProps {
    data: Array<{ name: string; value: number }>;
    title: string;
    yAxisLabel?: string;
    colorStart?: string;
    colorEnd?: string;
}

export const ChartButton = ({
    data,
    title,
    yAxisLabel = 'Valor',
    colorStart = '#795548', // primary-500
    colorEnd = '#3e2723',   // primary-900
}: ChartButtonProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const chartRef = useRef<HTMLDivElement>(null);
    const { resolvedTheme } = useTheme();

    const handleDownload = useCallback(async () => {
        if (!chartRef.current) return;
        const isDark = resolvedTheme === 'dark';
        const bgColor = isDark ? '#382f31' : '#ffffff';

        try {
            const dataUrl = await toPng(chartRef.current, { cacheBust: true, backgroundColor: bgColor });
            const link = document.createElement('a');
            link.download = `${title.toLowerCase().replace(/\s+/g, '-')}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error('Error downloading chart image', err);
        }
    }, [title]);

    if (!data || data.length === 0) return null;

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="inline-flex items-center justify-center rounded-full border border-primary-300 px-4 py-1 text-xs font-semibold text-primary-700 transition hover:bg-primary-100 dark:border-white/30 dark:text-white dark:hover:bg-white/10"
            >
                📊 Gráfica
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-[#382f31]">
                        <div className="flex items-center justify-between border-b border-primary-100 p-4 dark:border-white/10">
                            <h3 className="text-lg font-bold text-[var(--brand-text)] dark:text-white">
                                {title}
                            </h3>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-6">
                            <div
                                ref={chartRef}
                                className="rounded-xl bg-white p-4 dark:bg-[#382f31]"
                            >
                                <div className="mb-4 text-center">
                                    <h4 className="text-xl font-bold text-primary-900 dark:text-primary-100">
                                        {title}
                                    </h4>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        Generado por Xoco POS
                                    </p>
                                </div>

                                <div className="h-[400px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={data}
                                            margin={{
                                                top: 20,
                                                right: 30,
                                                left: 20,
                                                bottom: 40,
                                            }}
                                        >
                                            <defs>
                                                <linearGradient id="colorBrown" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor={colorStart} stopOpacity={0.9} />
                                                    <stop offset="95%" stopColor={colorEnd} stopOpacity={0.4} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.3} />
                                            <XAxis
                                                dataKey="name"
                                                angle={-45}
                                                textAnchor="end"
                                                height={60}
                                                tick={{ fill: 'currentColor', fontSize: 12 }}
                                            />
                                            <YAxis
                                                label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fill: 'currentColor' }}
                                                tick={{ fill: 'currentColor', fontSize: 12 }}
                                            />
                                            <Tooltip
                                                contentStyle={{
                                                    borderRadius: '12px',
                                                    border: 'none',
                                                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                                    color: '#3e2723'
                                                }}
                                                cursor={{ fill: 'rgba(121, 85, 72, 0.1)' }}
                                            />
                                            <Bar
                                                dataKey="value"
                                                name={yAxisLabel}
                                                fill="url(#colorBrown)"
                                                radius={[4, 4, 0, 0]}
                                                animationDuration={1500}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end gap-3">
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                                >
                                    Cerrar
                                </button>
                                <button
                                    onClick={handleDownload}
                                    className="flex items-center gap-2 rounded-full bg-primary-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-primary-500 shadow-lg shadow-primary-900/20"
                                >
                                    📸 Descargar PNG
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
