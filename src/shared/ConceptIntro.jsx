export default function ConceptIntro({ heading, lede, cards, footnote }) {
  return (
    <section className="det-intro" aria-labelledby="concept-intro-heading">
      <h2 id="concept-intro-heading" className="det-intro-heading">{heading}</h2>
      {lede && <p className="det-intro-lede">{lede}</p>}
      {cards?.length > 0 && (
        <div className={`det-intro-cards ${cards.length === 1 ? "det-intro-cards-one" : ""}`}>
          {cards.map((card) => (
            <div key={card.title} className={`det-intro-card ${card.tone ? `det-intro-card-${card.tone}` : ""}`}>
              <h3 className="det-intro-card-title">{card.title}</h3>
              <p className="det-intro-card-text">{card.body}</p>
              {card.example && <p className="det-intro-card-example">{card.example}</p>}
            </div>
          ))}
        </div>
      )}
      {footnote && <p className="det-intro-tradeoff">{footnote}</p>}
    </section>
  );
}
