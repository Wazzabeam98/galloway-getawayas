'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';
import { MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';

// The shared basket for a made-to-order (food-ordering) listing. The MENU lives
// in the main column and the BASKET in the sidebar — two separate components, so
// the cart they both read has to live above them. This context is that shared
// state, and nothing more: which items are in the basket, at what quantity.

export interface FoodMenuItem {
    id: string; name: string; description: string | null; price: number;
    unit: string; image: string | null; isCustom?: boolean; fulfilment?: string | null;
    ingredients?: string | null; allergens?: string | null;
}

interface CartContextValue {
    cart: Record<string, number>;
    setQty: (id: string, n: number) => void;
    lines: { it: FoodMenuItem; qty: number }[];
    total: number;
    count: number;
    hasCustom: boolean;
    items: FoodMenuItem[];
}

const CartContext = createContext<CartContextValue | null>(null);

export function useFoodCart(): CartContextValue {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error('useFoodCart must be used inside FoodCartProvider');
    return ctx;
}

export function FoodCartProvider({ items, children }: { items: FoodMenuItem[]; children: React.ReactNode }) {
    const [cart, setCart] = useState<Record<string, number>>({});
    const setQty = (id: string, n: number) => setCart((c) => {
        const next = { ...c };
        if (n <= 0) delete next[id]; else next[id] = Math.min(MAX_ORDER_QUANTITY, Math.max(0, Math.floor(n)));
        return next;
    });
    const value = useMemo<CartContextValue>(() => {
        const lines = items.map((it) => ({ it, qty: cart[it.id] || 0 })).filter((l) => l.qty > 0);
        return {
            cart, setQty, items, lines,
            total: lines.reduce((s, l) => s + l.it.price * l.qty, 0),
            count: lines.reduce((s, l) => s + l.qty, 0),
            hasCustom: lines.some((l) => !!l.it.isCustom),
        };
    }, [cart, items]);
    return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
