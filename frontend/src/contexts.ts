import React from 'react'

export const HomeFavContext = React.createContext<{
  homeTab: string
  saveHomeTab: (p: string) => void
}>({ homeTab: '/portfolio', saveHomeTab: () => {} })

export const NavModeContext = React.createContext<{
  navMode: 'top' | 'sidebar'
  setNavMode: (mode: 'top' | 'sidebar') => void
}>({ navMode: 'top', setNavMode: () => {} })
