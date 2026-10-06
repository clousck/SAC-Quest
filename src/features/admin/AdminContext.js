import { createContext, useContext } from 'react'

/** { admin, isAdmin, can, logout }; `can` sale de roles.js */
export const AdminContext = createContext(null)
export const useAdmin = () => useContext(AdminContext)

/** { event, setEvent, reloadEvent, pending, setPending } del evento abierto en el panel. */
export const EventAdminContext = createContext(null)
export const useEventAdmin = () => useContext(EventAdminContext)
