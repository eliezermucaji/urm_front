const socket = io('http://127.0.0.1:3001')

    function mostrarNotificacao({notification_type, id}) {
        const div = document.createElement("div");
        switch(notification_type) {
            case 1:
                div.innerHTML = `E aí, nova questão na plataforma, tente resolve-la.`;
                break;
            case 2:
                div.innerText = "Alguém, respondeu a uma questão, porque não tenta visualizar a resposta.";
                break;
        }

            div.style.position = "fixed";
            div.style.top = "20px";
            div.style.right = "20px";
            div.style.background = "#222";
            div.style.color = "#fff";
            div.style.padding = "15px";
            div.style.borderRadius = "10px";

            document.body.appendChild(div);

            setTimeout(() => {
                div.remove();
            }, 5000);
    };
    
    socket.on('new_question', (notification)=>{
        mostrarNotificacao(notification);
    });

    socket.on('new_answer', (notification)=>{
        mostrarNotificacao(notification);
    })