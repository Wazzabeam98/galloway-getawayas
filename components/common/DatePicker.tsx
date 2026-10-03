"use client"

import React, { useState } from 'react'
import 'react-date-range/dist/styles.css'; // main style file
import 'react-date-range/dist/theme/default.css'; // theme css file
import { addDays } from "date-fns";
import { DateRange, DateRangePicker } from 'react-date-range';
import { MONTH_ARROW_LABELS } from '@/lib/calendarLabels';

const DatePicker = ({ state, dateChangeCallback }: { state: any, dateChangeCallback: (data: any) => void }) => {


    return (
        <div>
            <div className='hidden md:block'>
                <DateRangePicker
                    ariaLabels={MONTH_ARROW_LABELS}
                    ranges={state}
                    moveRangeOnFirstSelection={false}
                    onChange={dateChangeCallback}
                    months={1}
                    weekStartsOn={1}
                    direction='horizontal'
                    showMonthAndYearPickers={false}
                />
            </div>
            <div className='md:hidden'>
                <DateRange
                    ariaLabels={MONTH_ARROW_LABELS}
                    ranges={state}
                    moveRangeOnFirstSelection={false}
                    onChange={dateChangeCallback}
                    months={1}
                    weekStartsOn={1}
                    direction='horizontal'
                    showMonthAndYearPickers={false}
                />
            </div>
        </div>
    )
}

export default DatePicker
