import React from 'react'

export function Label({ children, className = '' }) {
  return <label className={`block text-sm font-medium mb-1 ${className}`}>{children}</label>
}

export default Label
