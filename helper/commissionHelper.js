/*
 * Partner commission rules, used by reportsController.
 *
 * These are PORTS of the frontend rules, not new rules:
 *   commissionPerShare   = thangive-frontend/src/utils/stockCalculations.js  calculateCommissionPerShare
 *   commissionDeductions = thangive-frontend/src/components/modals/commissionPayment.jsx
 *                          (tdsAmount, amountAfterTDS, gstAmount, payableAmount)
 * The same formula is also copied in accountsDashboardController (kept as it is). If the frontend
 * rule ever changes, all copies must change with it.
 *
 * Commission is gross (before TDS / GST). Per share it is rounded to 2 decimals exactly like the
 * frontend (toFixed(2)), then multiplied by the order quantity.
 */

export function commissionPerShare(partnerPrice, stockPrice, transactionType) {
    partnerPrice = Number(partnerPrice);
    stockPrice = Number(stockPrice);

    // Gross Profit 1
    const baseCommission = (partnerPrice * 4) / 100;
    let result;

    if (transactionType === 'BUY') {
        // Buyer P - DP
        const difference = stockPrice - partnerPrice;
        if (difference >= baseCommission) {
            const GP = difference - baseCommission;
            const ExtraProfit = (GP * 70) / 100;
            result = ExtraProfit + baseCommission;
        } else {
            result = difference;
        }
    } else if (transactionType === 'SELL') {
        // Buyer DP - SP
        const difference = partnerPrice - stockPrice;
        if (difference >= baseCommission) {
            const GP = difference - baseCommission;
            const ExtraProfit = (GP * 70) / 100;
            result = ExtraProfit + baseCommission;
        } else {
            result = difference;
        }
    }
    const rounded = Number(Number(result).toFixed(2));
    return Number.isFinite(rounded) ? rounded : 0;
}

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * Same arithmetic as the commission payment modal: TDS is taken off the gross commission, GST is
 * calculated on the amount after TDS, and the payable amount is what is left after both.
 * tds / gst are the percentages stored on partner_commission.
 */
export function commissionDeductions(totalCommission, tdsPercentage, gstPercentage) {
    const total = Number(totalCommission) || 0;
    const tdsAmount = total * ((Number(tdsPercentage) || 0) / 100);
    const amountAfterTDS = total - tdsAmount;
    const gstAmount = amountAfterTDS * ((Number(gstPercentage) || 0) / 100);
    const payableAmount = amountAfterTDS - gstAmount;
    return {
        tds_amount: round2(tdsAmount),
        gst_amount: round2(gstAmount),
        payable_amount: round2(payableAmount),
    };
}
