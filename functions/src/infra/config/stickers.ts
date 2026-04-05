// functions/src/config/stickers.ts
// SUBSTITUIR as URLs abaixo pelas URLs reais copiadas do Storage

export const STICKERS = {
  hello: "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_hello.webp?alt=media&token=9f2b2b3a-1d47-4ba0-be1d-83cad9b13afc",
  
  pedidoConfirmado:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fjoinha_dudu.webp?alt=media&token=8966c3cf-a237-40da-affc-cf0e88d63878",
  
    pedidoSaiu:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_rindo.webp?alt=media&token=367e38b8-d001-4864-86ce-8281978c1504",
  
    pedidoEntregue:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fhello_dudu.webp?alt=media&token=fc580577-d0c3-47bb-a210-2f9b8f78bafb",
  
    dudu_problema_tecnico:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_problema_tecnico.webp?alt=media&token=655a919d-b03f-4a61-9473-0fe76f5db0c9",

    dudu_recusado:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_recusado.webp?alt=media&token=a5597e49-2021-456a-b646-34392a50cae6",

    dudu_deboa:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_deboa.webp?alt=media&token=e7f5414e-0970-4423-ad6e-657ea82f2eb3",

    dudu_esperando:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_esperando.webp?alt=media&token=74e4cfcf-55cc-43cb-bc34-eb46d8e71f86",

    feedback:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_feedback.webp?alt=media&token=561f4feb-f184-4c69-ab9b-a1487014f64f",
  
    rindo:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_rindo.webp?alt=media&token=367e38b8-d001-4864-86ce-8281978c1504",
    
    clap:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_clap.webp?alt=media&token=83ad6ca0-62f4-4961-b74d-70cd484871b8",

    salvaContato:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fsalva_dudu.webp?alt=media&token=b59c1ef0-80b1-45b0-9f5c-d9cb15abe1c8",
    
    duduPedido:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_fazendo_pedido.webp?alt=media&token=48598417-5666-495d-8b9a-fabcb4a546cb",
    
    problemaGeral: 
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_triste.webp?alt=media&token=eca49cbf-2150-4adf-ab96-6f5f33e0f58b"
  ,

  // Aliases padronizados por uso
  pedidoNovo:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_fazendo_pedido.webp?alt=media&token=48598417-5666-495d-8b9a-fabcb4a546cb",
  pedidoRecusado:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_recusado.webp?alt=media&token=a5597e49-2021-456a-b646-34392a50cae6",
  issueAberto:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_triste.webp?alt=media&token=eca49cbf-2150-4adf-ab96-6f5f33e0f58b",
  emergencia:
    "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2Fstickers%2Fdudu_problema_tecnico.webp?alt=media&token=655a919d-b03f-4a61-9473-0fe76f5db0c9"
}; 

export const STICKER_USAGE = {
  pedidoRoteado: "pedidoNovo",
  pedidoAceito: "pedidoConfirmado",
  pedidoRecusadoOuTimeout: "pedidoRecusado",
  saiuEntrega: "pedidoSaiu",
  entregueDeposito: "pedidoEntregue",
  clienteConfirmouChegou: "feedback",
  issueAberto: "issueAberto",
  emergencyHelp: "emergencia",
} as const;

